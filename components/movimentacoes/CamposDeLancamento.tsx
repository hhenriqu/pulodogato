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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarClock, CreditCard, Receipt, Repeat } from "lucide-react";
import { CampoDeData } from "@/components/ui/campo-de-data";
import { janelaDeFaturas, rotuloDaFatura } from "@/lib/fatura-do-cartao";
import { CampoDeCotacao } from "@/components/movimentacoes/CampoDeCotacao";
import {
  SeletorDeCategoria,
  type ResultadoDeCriacao,
} from "@/components/movimentacoes/SeletorDeCategoria";
import type {
  PreferenciaDeCategoria,
  Subcategoria,
} from "@/lib/categorias";
import {
  camposDoTipo,
  contasDoSeletor,
  diaDeVencimentoValido,
  ehNaturezaFixa,
  lugarDaNatureza,
  lugaresDoTipo,
  naturezaDoLugar,
  parcelaDigitada,
  resumoDaSerie,
  serieDeParcelas,
  MAX_MESES_DE_REPETICAO,
  type CategoriaDeLancamento,
  type ContaDeLancamento,
  type DuracaoDaRepeticao,
  type LugarDoLancamento,
  type TipoLancamento,
  type ValoresDeLancamento,
} from "@/lib/lancamento";

// ---------------------------------------------------------------------------
// OS ROTULOS DE CADA LUGAR, POR TELA (HMO-254)
// ---------------------------------------------------------------------------
// Tabela em vez de `tipo === "expense" ? ... : ...` espalhado pelo JSX: o
// ternario aninhado e onde a receita herdou "Despesa Fixa" escrito na tela dela.
//
// O SELETOR PERGUNTA O LUGAR, NAO A NATUREZA. "Despesa Pontual" virou "Despesa"
// -- o pedido e literal ("devem se chamar apenas despesa") --, e o motivo nao e
// so o nome: com a checkbox "Fixa" ao lado, "Pontual" passou a CONTRADIZER a
// tela. Uma "Despesa Pontual" com Fixa marcada e uma frase que se nega, e quem
// lesse o seletor acreditaria nele.
const ROTULO_DO_LUGAR: Record<
  TipoLancamento,
  Record<LugarDoLancamento, string>
> = {
  expense: {
    conta: "Despesa",
    cartao: "Gasto no Cartão",
  },
  income: {
    conta: "Receita",
    // A receita nao tem seletor de lugar (`campos.natureza` e falso nela), mas a
    // tabela e um `Record` COMPLETO de proposito: o `tsc` cobra a chave, e um
    // mapa pela metade so falharia em runtime no dia em que a receita ganhasse o
    // seletor -- com o gatilho do radix VAZIO, que parece tela nao carregada.
    cartao: "Gasto no Cartão",
  },
};

const AJUDA_DO_LUGAR: Record<
  TipoLancamento,
  Record<LugarDoLancamento, string>
> = {
  expense: {
    conta: "Sai do saldo da conta escolhida. Cartão de crédito não entra aqui.",
    cartao:
      "Entra na fatura do cartão escolhido, no mês certo conforme o dia do fechamento.",
  },
  income: {
    conta: "Entra no saldo da conta escolhida.",
    cartao: "",
  },
};

const ICONE_DO_LUGAR: Record<LugarDoLancamento, typeof Receipt> = {
  conta: Receipt,
  cartao: CreditCard,
};

const COR_DO_LUGAR: Record<LugarDoLancamento, string> = {
  conta: "text-muted-foreground",
  cartao: "text-info",
};

interface CamposDeLancamentoProps {
  tipo: TipoLancamento;
  valores: ValoresDeLancamento;
  /** Recebe so o que mudou; quem mescla e o container. */
  aoMudar: (mudanca: Partial<ValoresDeLancamento>) => void;
  categorias: CategoriaDeLancamento[];
  contas: ContaDeLancamento[];
  editando: boolean;
  /**
   * A personalizacao de categoria da pessoa (HMO-216). Vazio e o caso normal.
   *
   * Vem pronta de `/api/personal-finance/categories` -- este componente nao
   * busca nada, e por isso o teste consegue renderizar a arvore de verdade.
   */
  prefsDeCategoria?: PreferenciaDeCategoria[];
  /** As subcategorias visiveis, de todas as categorias (HMO-216). */
  subcategorias?: Subcategoria[];
  /**
   * Cria categoria/subcategoria no servidor. OPCIONAIS: quando ausentes, o
   * item "Criar nova..." nao aparece.
   *
   * Isso e o que mantem a tela honesta sem rede. A fila offline sabe gravar um
   * LANCAMENTO para depois; ela nao sabe criar categoria, porque o id da
   * categoria e quem o lancamento referencia -- uma categoria "pendente" nao
   * teria id para o lancamento apontar. Oferecer o botao ali daria um erro
   * depois de a pessoa digitar o nome.
   */
  aoCriarCategoria?: (nome: string) => Promise<ResultadoDeCriacao>;
  aoCriarSubcategoria?: (
    categoriaId: string,
    nome: string
  ) => Promise<ResultadoDeCriacao>;
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
  /**
   * O centro da janela de meses do seletor de fatura, 'AAAA-MM' (HMO-289).
   *
   * PROP e nao calculado aqui, porque o padrao depende da TELA DE ORIGEM
   * (`?de=&ate=`) e do RELOGIO -- e este componente e de proposito sem URL, sem
   * banco e sem relogio: e o que permite ao teste renderiza-lo de verdade e
   * afirmar sobre a arvore que sai. Quem calcula e
   * `faturaPadraoDoLancamento`, em lib/fatura-do-cartao.ts, chamada pelo
   * formulario.
   *
   * O default vazio nao e um padrao util -- e o que mantem a prop opcional para
   * os chamadores que nao mostram o bloco do cartao. Com ele, `janelaDeFaturas`
   * recebe '' e a janela sai sem mes nenhum: o seletor fica so com a opcao
   * "pela data da compra", que e honesto, em vez de oferecer o ano 0.
   */
  mesPadraoDaFatura?: string;
}

export function CamposDeLancamento({
  tipo,
  valores,
  aoMudar,
  categorias,
  contas,
  editando,
  rateio,
  prefsDeCategoria = [],
  subcategorias = [],
  aoCriarCategoria,
  aoCriarSubcategoria,
  moedaPorLancamento = false,
  moedaOficial = MOEDA_PADRAO,
  cartaoFixado = null,
  mesPadraoDaFatura = "",
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
  const contasVisiveis = contasDoSeletor(contas, tipo, valores.natureza);
  const lugaresVisiveis = lugaresDoTipo(tipo);
  // OS DOIS EIXOS DE `natureza`, LIDOS POR FUNCAO E NAO POR `===` (HMO-254)
  //
  // O seletor escreve um deles e a checkbox o outro, no MESMO campo do estado.
  // Decompor aqui, num lugar so, e o que faz os dois controles concordarem com o
  // que esta gravado: um `valores.natureza === "card"` no JSX do seletor leria
  // `false` em `card_fixed` e mostraria "Despesa" selecionado numa tela que esta
  // gravando no cartao.
  const lugarAtual = lugarDaNatureza(valores.natureza);
  const fixaMarcada = ehNaturezaFixa(valores.natureza);
  // A conta escolhida, para saber que moeda ela sugere.
  const contaEscolhida = contas.find((c) => c.id === valores.contaId);

  // O RESUMO DAS PARCELAS SAI DE FUNCAO PURA, E NAO DE UMA CONTA NO JSX
  //
  // No bloco antigo a aritmetica do parcelamento estava dentro do `onChange` e
  // dentro do texto de ajuda (`valorNumerico(valorDaParcela) * totalDeParcelas`,
  // duas vezes, em dois lugares). Duas copias da mesma multiplicacao divergem na
  // primeira mudanca, e a que ficaria errada e a que o usuario LE -- a outra e a
  // que grava. Aqui a tela nao faz conta nenhuma: ela exibe o que
  // `serieDeParcelas` respondeu, que e a mesma funcao que a rota usa para montar
  // as linhas.
  //
  // Sem `useMemo`: sao quatro inteiros e uma string, e um `useMemo` aqui
  // esconderia o custo real (zero) atras de uma lista de dependencias que
  // envelhece.
  const resumo = valores.parcelado
    ? resumoDaSerie(
        serieDeParcelas({
          valor: valores.valor,
          base: valores.baseDoValorParcelado,
          // `parcelaDigitada` devolve NaN com o campo vazio, e
          // `serieDeParcelas` devolve `null` para NaN -- entao o resumo
          // DESAPARECE enquanto a pessoa esta apagando o numero, em vez de
          // exibir "1x de R$ 300,00". Um resumo parcial se le como resposta, e
          // seria uma mentira pior que o campo vazio.
          parcelaAtual: parcelaDigitada(valores.parcelaAtual),
          totalDeParcelas: parcelaDigitada(valores.totalDeParcelas),
          vencimentoDaParcelaAtual: valores.data,
        })
      )
    : null;

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
                  {ROTULO_DO_LUGAR[tipo].cartao}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {AJUDA_DO_LUGAR[tipo].cartao}
              </p>
            </>
          ) : (
            <>
          <Select
            value={lugarAtual}
            onValueChange={(value) =>
              aoMudar({
                // A natureza sai da COMPOSICAO dos dois eixos, e nao do valor do
                // seletor: trocar de lugar nao pode desligar a checkbox "Fixa"
                // que esta marcada na tela (HMO-254). Quem marcou "Fixa" e
                // depois trocou para cartao quer uma assinatura no cartao, e um
                // `natureza: value` cru aqui gravaria a compra.
                natureza: naturezaDoLugar(
                  value as LugarDoLancamento,
                  fixaMarcada
                ),
                // Trocar de lugar invalida a conta escolhida: as duas listas sao
                // DISJUNTAS desde a HMO-254 (cartoes x nao-cartoes), e manter o
                // id antigo deixaria selecionada uma conta que nao esta mais no
                // seletor -- com o radix mostrando o nome dela, porque ele le de
                // `contas` e nao de `contasVisiveis`.
                contaId: "",
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
              {/* As opcoes saem de `lugaresDoTipo`, nao de dois itens fixos:
                  receita nao tem "no cartao", e um item a mais aqui deixaria a
                  tela oferecer um caminho que a validacao recusa depois. */}
              {lugaresVisiveis.map((opcao) => {
                const Icone = ICONE_DO_LUGAR[opcao];
                return (
                  <SelectItem key={opcao} value={opcao}>
                    <div className="flex items-center gap-2">
                      <Icone className={`h-4 w-4 ${COR_DO_LUGAR[opcao]}`} />
                      <span>{ROTULO_DO_LUGAR[tipo][opcao]}</span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {AJUDA_DO_LUGAR[tipo][lugarAtual]}
          </p>
            </>
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

        {/* PARCELAMENTO: ABAIXO DO VALOR, PORQUE A PERGUNTA E SOBRE O VALOR
            (HMO-211)

            "Sobre parcelar, deve ser um checkbox abaixo do valor do cartao e ao
            clicar perguntar se o valor que esta no input e o da parcela ou
            total, e em qual parcela aquela se refere de quantas no total."

            A posicao e parte do pedido, e ela nao e cosmetica: a primeira coisa
            que a checkbox faz e mudar o SIGNIFICADO do campo logo acima. No
            bloco antigo ela ficava no fim do formulario, depois das datas e da
            confirmacao, com dois campos proprios de dinheiro -- "Numero de
            Parcelas" e "Valor da Parcela" -- e o campo de valor de cima era
            sobrescrito em silencio por `parcela * N`. Quem digitasse o preco da
            etiqueta via o proprio numero mudar sem ter tocado nele. */}
        {/* AS DUAS CHECKBOXES NA MESMA CAIXA, LADO A LADO (HMO-254)

            "tem o check box ao lado do parcelamento, voce escolhe, fixo ou
            parcelado ou caso nenhum nem outro ambos desmarcados ai e gasto
            normal."

            A posicao e o pedido, e ela carrega a regra: as duas sao os UNICOS
            modificadores de um gasto no cartao, e sao exclusivas. Lado a lado as
            duas respostas aparecem juntas e o "nenhuma das duas" fica visivel
            como estado -- e ele e o caso comum, o gasto normal. Em dois blocos
            separados do formulario, a pessoa que marcou "Fixa" no topo encontra
            "Parcelar" trinta linhas abaixo e nao tem como saber que uma desliga a
            outra.

            UMA CAIXA SO, E NAO UMA PARA CADA: a caixa e o que diz "estas duas
            perguntas sao sobre o valor acima". Era o que o bloco do parcelamento
            ja fazia desde a HMO-211 ("abaixo do valor, porque a pergunta e sobre
            o valor"), e a Fixa tem a mesma relacao com o campo -- ela decide se
            aquele numero e uma saida unica ou a parcela mensal de uma regra.

            NA RECEITA E NA DESPESA DE CONTA so existe a Fixa, e a caixa fica com
            uma checkbox: `campos.parcelamento` e falso fora do cartao desde a
            HMO-211. O `||` na condicao e o que mantem a caixa viva nesses casos
            -- com `&&` a receita fixa (HMO-170) perderia o unico controle que
            cria a regra do salario. */}
        {(campos.fixa || campos.parcelamento) && (
          <div className="space-y-4 p-4 border rounded-lg bg-muted/20">
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
              {/* A CHECKBOX "FIXA" (HMO-254)

                  "ter um checkbox de Fixa. Se tornando uma despesa fixa."

                  A marcacao escreve `parcelado: false` junto. Nao e zelo:
                  `parcelado` sobrevive a marcacao desta checkbox (o estado e um
                  objeto so), e com ele `true` no estado a volta para "nao fixa"
                  reabriria o bloco de parcelamento JA MARCADO, com o N e o M que
                  a pessoa tinha preenchido antes -- uma serie de 10x pronta para
                  gravar que ela nao pediu de novo.

                  A TRAVA DE DINHEIRO NAO E ESTA LINHA, e `campos.parcelamento`:
                  ele e falso em `card_fixed`, entao `destinoDoLancamento` nao
                  consegue escolher "parcelas" nem com `parcelado: true` parado no
                  estado (o ramo exige as duas coisas). Esta linha e para a TELA
                  nao mentir; a de lib/lancamento.ts e para o banco nao errar. */}
              {campos.fixa && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_fixed"
                    checked={fixaMarcada}
                    onChange={(e) =>
                      aoMudar({
                        natureza: naturezaDoLugar(lugarAtual, e.target.checked),
                        parcelado: false,
                      })
                    }
                  />
                  <Label htmlFor="is_fixed" className="font-medium">
                    {campos.rotuloDaFixa}
                  </Label>
                </div>
              )}

              {campos.parcelamento && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_installment"
                    checked={valores.parcelado}
                    onChange={(e) => aoMudar({ parcelado: e.target.checked })}
                  />
                  <Label htmlFor="is_installment" className="font-medium">
                    Parcelar esta compra
                  </Label>
                </div>
              )}
            </div>

            {campos.fixa && (
              <p className="text-xs text-muted-foreground">
                {campos.ajudaDaFixa}
              </p>
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
                {/* QUANDO COMECA (HMO-247)

                    Com o campo "Data" fora da tela, este dia passou a ser a
                    UNICA resposta para "quando isso cai?" -- e a pergunta que vem
                    depois ("entao ja cai este mes?") nao tinha onde ser
                    respondida. A frase diz a regra que `firstOccurrence`
                    (lib/recurrence.ts) ja aplica.

                    TEXTO, E NAO A DATA CALCULADA: calcular a primeira ocorrencia
                    aqui seria uma SEGUNDA copia da aritmetica de
                    `firstOccurrence`, e lib/lancamento.ts nao pode importa-la (o
                    modulo e compilado sozinho pelo `test:lancamento`, sem
                    reescrita do alias `@/`). Duas copias da mesma conta divergem,
                    e a divergencia apareceria como uma tela prometendo um dia e a
                    agenda mostrando outro. */}
                {diaDeVencimentoValido(valores.diaDeVencimento) && (
                  <p className="text-xs text-muted-foreground">
                    {tipo === "expense"
                      ? "A primeira cobrança"
                      : "A primeira entrada"}{" "}
                    é no próximo dia {Number(valores.diaDeVencimento)}: neste
                    mês, se ele ainda não passou; no mês que vem, se já passou.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Dia 29, 30 ou 31 cai no último dia do mês quando o mês for
                  mais curto.
                </p>
              </div>
            )}

            {/* POR QUANTOS MESES (HMO-170)
                O bloco so existe junto com o dia do vencimento --
                `campos.duracao` tem a mesma condicao -- porque as duas perguntas
                descrevem a MESMA regra. Mostrar a duracao sem o dia deixaria a
                pessoa dizer "por 12 meses" sem dizer quando vence.

                SEM A MOLDURA PROPRIA desde a HMO-254: ele ja esta DENTRO da caixa
                das checkboxes, e uma segunda borda aqui desenharia uma caixa
                dentro da outra -- a tela sugeriria que a duracao e uma terceira
                pergunta independente, e nao parte da regra que a Fixa criou. */}
            {campos.duracao && (
              <div className="space-y-3">
                <Label>Por quanto tempo *</Label>
                <Select
                  value={valores.duracao}
                  onValueChange={(value) =>
                    aoMudar({
                      duracao: value as DuracaoDaRepeticao,
                      // Voltar para "todos os meses" limpa a contagem: deixar o
                      // numero no estado faria ele voltar a valer se a pessoa
                      // trocasse de novo, cadastrando um prazo que ela ja tinha
                      // desistido de por.
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

            {valores.parcelado && campos.parcelamento && (
              <div className="space-y-4">
                {/* A PERGUNTA, EM RADIO E NAO EM SELECT

                    Duas opcoes exclusivas das quais NENHUMA e um padrao
                    inofensivo: ler "1.000" como parcela ou como total da uma
                    compra dez vezes diferente. Radio mostra as duas respostas ao
                    mesmo tempo; um select mostra uma e esconde a outra atras de
                    um clique, e o valor que fica visivel passa por "o normal".

                    `<input type="radio">` nativo, e nao o Select do Radix: o
                    teste desta tela renderiza com `react-dom/server`, e o Radix
                    Select nao imprime o valor escolhido no servidor -- a
                    assercao leria vazio em qualquer caso. */}
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">
                    O valor acima é:
                  </legend>
                  <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        id="base_parcela"
                        name="base_do_valor"
                        value="parcela"
                        checked={valores.baseDoValorParcelado === "parcela"}
                        onChange={() =>
                          aoMudar({ baseDoValorParcelado: "parcela" })
                        }
                      />
                      <Label htmlFor="base_parcela">
                        o valor de cada parcela
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        id="base_total"
                        name="base_do_valor"
                        value="total"
                        checked={valores.baseDoValorParcelado === "total"}
                        onChange={() =>
                          aoMudar({ baseDoValorParcelado: "total" })
                        }
                      />
                      <Label htmlFor="base_total">o total da compra</Label>
                    </div>
                  </div>
                </fieldset>

                {/* "EM QUAL PARCELA AQUELA SE REFERE DE QUANTAS NO TOTAL"

                    Os dois campos ficam lado a lado e na ordem da frase (N, e
                    depois M), com o "de" entre eles -- e o unico jeito de a tela
                    dizer qual e qual sem rotulo longo. Inverter o par e o erro
                    de digitacao mais provavel daqui, e `validarLancamento` tem
                    uma frase propria para ele ("A parcela atual tem que estar
                    entre 1 e M").

                    OS DOIS CAMPOS DEIXAM APAGAR O CONTEUDO (HMO-226)

                    O pedido era literal: "vem preenchido como 1, nao
                    permitindo apagar". O `onChange` daqui era
                    `parseInt(e.target.value) || 1`, e como o input e controlado
                    por `valores`, o Backspace repunha o "1" no MESMO quadro --
                    nao existia estado em que o campo aparecesse vazio. Quem
                    queria 6 digitava ao lado do "1" e produzia 16.

                    As tres pecas do conserto, e as tres sao necessarias:

                      1. o estado guarda TEXTO (ver `parcelaAtual` em
                         lib/lancamento.ts), que e o que permite `""` existir;
                      2. `onFocus` + `select()`: clicar seleciona o "1" e a
                         primeira tecla o substitui -- o "quando clicar ele
                         apague" do pedido, sem deixar o campo vazio para quem
                         so passou por ele com Tab;
                      3. `onBlur` vazio repoe o padrao, para a tela nao ficar
                         guardando um campo em branco depois que a pessoa saiu
                         dele.

                    O que NAO voltou foi o `|| 1` do `onChange`: enquanto ele
                    existia, apagar o campo gravava "parcelado em 1 vez" sem
                    ninguem ter pedido, e era isso que fazia o bug ser invisivel.
                    Quem recusa o vazio agora e `validarLancamento`, com frase
                    propria. */}
                <div className="flex items-end gap-2">
                  <div className="space-y-2">
                    <Label htmlFor="parcela_atual">Parcela</Label>
                    <Input
                      id="parcela_atual"
                      type="number"
                      min="1"
                      max={valores.totalDeParcelas}
                      className="w-20"
                      value={valores.parcelaAtual}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) =>
                        aoMudar({ parcelaAtual: e.target.value })
                      }
                      onBlur={(e) => {
                        if (!e.target.value.trim())
                          aoMudar({ parcelaAtual: "1" });
                      }}
                    />
                  </div>
                  <span className="pb-2 text-sm text-muted-foreground">de</span>
                  <div className="space-y-2">
                    <Label htmlFor="total_installments">Parcelas</Label>
                    <Input
                      id="total_installments"
                      type="number"
                      min="2"
                      max="60"
                      className="w-20"
                      value={valores.totalDeParcelas}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) =>
                        aoMudar({ totalDeParcelas: e.target.value })
                      }
                      onBlur={(e) => {
                        if (!e.target.value.trim())
                          aoMudar({ totalDeParcelas: "1" });
                      }}
                    />
                  </div>
                </div>

                {/* O RESUMO E A DEFESA CONTRA A PERGUNTA RESPONDIDA ERRADO

                    Nenhum padrao de "parcela ou total" protege quem leu rapido,
                    entao a tela mostra a conta FEITA -- parcela, total, quantas
                    linhas vao ser criadas -- antes do Salvar. `resumoDaSerie` e
                    pura e devolve null quando ainda nao da para fazer a conta:
                    um resumo parcial ("10x de R$ 0,00") se le como resposta.

                    E e aqui que a decisao (A) da HMO-208 fica visivel: lancar
                    "parcela 3 de 10" grava 8 linhas, e esta frase e o unico
                    lugar que diz isso antes de gravar. */}
                {resumo && (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="resumo-das-parcelas"
                  >
                    {resumo}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* CATEGORIA + SUBCATEGORIA (HMO-216)
            Os dois seletores e o "criar" saem de `SeletorDeCategoria`. O
            filtro por tipo e a ordenacao foram para `categoriasDoSeletor` --
            `categoriasDoTipo` continua existindo em lib/lancamento.ts porque a
            fila offline e a rota de parcelas tambem a chamam.

            Vem DEPOIS do parcelamento no rebase da HMO-211, e nao antes: a
            checkbox tem que encostar no campo de valor, porque a primeira coisa
            que ela faz e mudar o significado daquele numero. */}
        <SeletorDeCategoria
          tipo={tipo}
          categorias={categorias}
          prefs={prefsDeCategoria}
          subcategorias={subcategorias}
          categoriaId={valores.categoriaId}
          subcategoriaId={valores.subcategoriaId ?? ""}
          aoMudar={aoMudar}
          aoCriarCategoria={aoCriarCategoria}
          aoCriarSubcategoria={aoCriarSubcategoria}
        />

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

          {/* EM QUAL FATURA ESSA COMPRA CAI (HMO-281 / HMO-289)

              "compro hoje e vai para a fatura que fecha semana que vem,
              indiferente da data que estou lancando."

              AO LADO DO SELETOR DE CARTAO, e nao perto do campo de data, embora
              a pergunta pareca de data: ela e sobre o CARTAO. Encostada na data
              da compra, as duas se leriam como a mesma resposta em dois campos --
              e a coisa mais importante desta tela e que elas NAO sao: a data da
              compra continua sendo o dia em que a compra aconteceu.

              UM `<select>`, E NAO `<input type="month">` NEM CAMPO DE DATA
              -----------------------------------------------------------
              A pergunta e FECHADA: e uma lista de faturas, nao uma data livre.
              `<input type="month">` aceita qualquer mes do calendario (inclusive
              2031) e, como todo campo de data nativo neste app, engole a
              digitacao -- e por isso que `components/ui/campo-de-data.tsx`
              existe e que `check-campo-de-data.mjs` esta no pre-commit.

              `<select>` NATIVO e nao o `Select` do Radix usado acima, e isto e
              deliberado: o Radix nao imprime o valor escolhido na renderizacao de
              servidor (o mesmo motivo pelo qual `cartaoFixado` e texto), entao o
              teste de tela nao conseguiria afirmar QUAL fatura esta marcada --
              que e exatamente o que esta issue precisa provar.

              O ROTULO SAI DE `rotuloDaFatura`, que ja devolve "outubro de 2026" e
              ja devolve `null` para o ilegivel. Nenhuma tabela de meses nova: uma
              segunda lista de nomes de mes divergiria da primeira em acento ou em
              ordem, e o seletor passaria a discordar do cabecalho da fatura. */}
          {campos.faturaDoLancamento && (
            <div className="space-y-2 pt-1">
              <Label htmlFor="invoice-month">Fatura</Label>
              <select
                id="invoice-month"
                aria-label="Fatura"
                value={valores.mesDaFatura}
                onChange={(e) => aoMudar({ mesDaFatura: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {/* O VAZIO E UMA OPCAO DE VERDADE, e nao um placeholder.

                    Ele grava `invoice_month_override` NULO, que e a regra da 006
                    (a fatura sai da data) e o estado de toda compra lancada antes
                    desta feature. Sem esta opcao, quem abrisse uma compra ANTIGA
                    para editar veria um `value=""` que nao casa com nenhuma
                    `<option>` -- e um `<select>` nessa situacao nao mostra vazio,
                    mostra a PRIMEIRA opcao como se fosse a escolhida. Salvar sem
                    tocar no campo moveria a compra de fatura sozinho.

                    E ela e o unico caminho de VOLTA: sem o vazio, uma escolha
                    feita por engano nao teria como ser desfeita. */}
                <option value="">Pela data da compra</option>
                {janelaDeFaturas(mesPadraoDaFatura, valores.mesDaFatura).map(
                  (mes) => (
                    <option key={mes} value={mes}>
                      {rotuloDaFatura(mes) ?? mes}
                    </option>
                  )
                )}
              </select>
              <p className="text-xs text-muted-foreground">
                A data da compra não muda — só a fatura em que ela entra.
              </p>
            </div>
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
            `campos.dataDeRealizacao`, nao `valores.confirmado` -- um `false`
            parado no estado nao pode apagar o campo de um gasto no cartao nem de
            uma edicao.

            E SOME NA DESPESA/RECEITA FIXA (HMO-247), por decisao da issue: la
            quem diz quando a conta cai e "Vence todo dia N", logo acima. Este
            campo era o `start_date` da regra, que `due_day` manda embora de todo
            jeito -- duas datas na tela para uma pergunta so. A regra passa a
            comecar hoje; ver `regraDeRecorrencia`. */}
        {campos.dataDeRealizacao && (
          <div className="space-y-2">
            <Label htmlFor="date">{campos.rotuloDaData}</Label>
            {/* `CampoDeData` e nao o controle de data nativo (HMO-238): o controle
                nativo devolvia "32026-10-02" quando o dedo caia no centro do
                campo preenchido, e "" no campo vazio -- oito teclas e nada
                gravado. Ele continua emitindo AAAA-MM-DD, que e o que
                `validarLancamento` exige. */}
            <CampoDeData
              id="date"
              value={valores.data}
              onChange={(data) => aoMudar({ data })}
              aria-label={campos.rotuloDaData}
            />
          </div>
        )}

        {campos.dataPrevista && (
          <div className="space-y-2">
            <Label htmlFor="expected-date">{campos.rotuloDaDataPrevista}</Label>
            <CampoDeData
              id="expected-date"
              value={valores.dataPrevista}
              onChange={(dataPrevista) => aoMudar({ dataPrevista })}
              aria-label={campos.rotuloDaDataPrevista}
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
