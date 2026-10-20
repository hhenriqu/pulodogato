"use client";

// ---------------------------------------------------------------------------
// LANCAR MOVIMENTACAO, EM MODAL (HMO-252)
// ---------------------------------------------------------------------------
// A HMO-249 deixou as tres telas de lancamento de `financial_transactions`
// (despesa, receita, transferencia) como modal, com volta para a tela de origem
// e interruptor "Salvar e continuar". Ficou de fora a unica tela de lancamento
// que nao era modal nenhum: os dois formularios de /dashboard/investments, que
// eram `<Card>` empilhados no corpo da pagina, abaixo de uma lista de ativos e
// de dois graficos. Esta e a de lancamento -- compra, venda e provento.
//
// POR QUE AQUI O MODAL NAO E A ROTA, COMO NA HMO-249
// --------------------------------------------------
// La o modal nasce `open` e fechar e NAVEGAR, porque as tres telas sao rotas
// com `?id=`, `?cartao=` e `?origem=` penduradas no endereco e com links
// publicados apontando para elas (ver o cabecalho de `ModalDeLancamento`).
// Aqui nao ha rota nenhuma: o formulario sempre foi uma secao desta pagina, nao
// tem endereco proprio e nao e alvo de link de fora. Entao o modal e estado da
// pagina, e `ModalDeLancamento` e montado CONDICIONALMENTE -- quem chama so o
// renderiza quando esta aberto.
//
// Isso traz uma propriedade de graca, e ela e deliberada: cada abertura e uma
// MONTAGEM nova, logo o estado do formulario nasce limpo sem nenhum efeito de
// sincronizacao. Nao existe o estado "modal fechado guardando a compra de
// ontem" para esquecer de limpar.
//
// O CUIDADO QUE NAO PODE SE PERDER
// --------------------------------
// Com "Salvar e continuar" ligado, o reset tem de limpar quantidade, preco e
// taxas. Com eles na tela, UM segundo clique grava a mesma compra outra vez --
// e em investimento isso nao erra so o total: erra o PRECO MEDIO do ativo, que
// `lib/investments.ts` calcula sobre as movimentacoes, e dele saem o lucro, o
// prejuizo e a rentabilidade exibidos. A pessoa nao tem como notar olhando a
// lista, porque o numero errado parece um numero.
//
// Quem decide isso e `proximaMovimentacaoDeCarteira`, em
// lib/retorno-do-lancamento.ts -- uma funcao pura, ao lado das duas irmas da
// HMO-249, coberta por `npm run test:retorno-lancamento` e por cinco mutantes
// em `npm run mutantes:retorno-lancamento`. Nao reescreva o reset aqui.
// ---------------------------------------------------------------------------

import { useState } from "react";

import { ModalDeLancamento } from "@/components/movimentacoes/ModalDeLancamento";
import { SalvarEContinuar } from "@/components/movimentacoes/SalvarEContinuar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CampoDeData } from "@/components/ui/campo-de-data";
import { CampoDeValor } from "@/components/ui/campo-de-valor";
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
import { proximaMovimentacaoDeCarteira } from "@/lib/retorno-do-lancamento";
import type { AssetType, InvestmentKind } from "@/lib/investments";

/** O que o seletor de ativo precisa saber de cada ativo. */
export interface AtivoParaLancar {
  id: string;
  symbol: string;
  name: string;
  /**
   * `fixed_income` troca os dois campos de cota pelo campo em reais (HMO-439).
   *
   * Vem de FORA e nao de um `ehRendaFixa` booleano montado pela tela: o tipo e
   * dado do ativo, e um booleano calculado em quem chama seria uma segunda
   * leitura do mesmo `type` para divergir da primeira.
   */
  type: AssetType;
}

/**
 * O estado do formulario, em UM objeto.
 *
 * Eram seis `useState` soltos na pagina. Juntos porque o reset de "Salvar e
 * continuar" e uma decisao sobre o CONJUNTO -- com seis setters, "limpei
 * quantidade e preco" e seis linhas espalhadas que ninguem pode testar, e foi
 * exatamente a forma de erro que a issue pediu para fechar.
 */
export interface ValoresDaMovimentacao {
  assetId: string;
  kind: InvestmentKind;
  quantidade: string;
  preco: string;
  taxas: string;
  data: string;
  /**
   * O valor em reais do aporte de RENDA FIXA (HMO-439), em notacao plana
   * ("10000.00") como `CampoDeValor` emite.
   *
   * Campo PROPRIO e nao `quantidade` reaproveitada, mesmo sendo ele que vai
   * para `quantity` no banco. Dois motivos, e o segundo e de dinheiro:
   *
   *   - o formato e outro: `quantidade` e numero cru de oito casas e este e
   *     dinheiro mascarado em pt-BR, com virgula;
   *   - reaproveitado, o valor digitado para um CDB continuaria no estado ao
   *     trocar o ativo para uma PETR4 -- e R$ 10.000,00 digitados como "valor
   *     do aporte" reapareceriam como QUANTIDADE de acoes, num campo que a
   *     pessoa ja preencheu e nao vai reler. Separados, cada campo so e lido
   *     pelo tipo que o mostra.
   */
  valorDoAporte: string;
}

const ROTULO_KIND: Record<InvestmentKind, string> = {
  buy: "Compra",
  sell: "Venda",
  dividend: "Provento",
};

/**
 * Os rotulos do campo de dinheiro em renda fixa, por tipo de movimentacao.
 *
 * "Valor do aporte" e o texto que a issue-mae pede, e ele vale para o `buy`. Nos
 * outros dois seria mentira na tela: um resgate nao e um aporte, e o campo
 * mandaria a pessoa digitar o valor de uma operacao chamando-a pelo nome da
 * operacao oposta.
 */
const ROTULO_VALOR_DA_RENDA_FIXA: Record<InvestmentKind, string> = {
  buy: "Valor do aporte (R$)",
  sell: "Valor do resgate (R$)",
  dividend: "Valor recebido (R$)",
};

/** O mesmo para a data -- "Data do aporte" e o outro texto que a issue pede. */
const ROTULO_DATA_DA_RENDA_FIXA: Record<InvestmentKind, string> = {
  buy: "Data do aporte",
  sell: "Data do resgate",
  dividend: "Data do recebimento",
};

/**
 * O estado em que o formulario abre.
 *
 * `assetId` entra de fora porque "Lançar movimentação" tem dois caminhos: o
 * botao do cabecalho (sem ativo escolhido) e o `+` de uma linha da carteira,
 * que ja sabe de qual ativo se trata.
 */
export function valoresDaMovimentacaoVazios(
  hoje: string,
  assetId = ""
): ValoresDaMovimentacao {
  return {
    assetId,
    kind: "buy",
    quantidade: "",
    preco: "",
    taxas: "",
    data: hoje,
    valorDoAporte: "",
  };
}

/**
 * `true` quando o ativo ESCOLHIDO e renda fixa -- a chave da tela (HMO-439).
 *
 * `false` enquanto nenhum ativo esta escolhido: o formulario abre no caso comum.
 * Funcao exportada, e nao um `ehRendaFixa` que a pagina passa por prop, porque
 * duas leituras do mesmo `type` sao duas chances de divergir -- e a divergencia
 * aqui e um campo de cota aberto para um CDB, ou o oposto.
 */
export function ehAtivoDeRendaFixa(
  ativos: AtivoParaLancar[],
  assetId: string
): boolean {
  return ativos.some((a) => a.id === assetId && a.type === "fixed_income");
}

interface CamposDaMovimentacaoProps {
  ativos: AtivoParaLancar[];
  valores: ValoresDaMovimentacao;
  /** Hoje em AAAA-MM-DD: o teto do calendario. */
  hoje: string;
  aoMudar: <C extends keyof ValoresDaMovimentacao>(
    chave: C,
    valor: ValoresDaMovimentacao[C]
  ) => void;
}

/**
 * OS CAMPOS, EM COMPONENTE PROPRIO (HMO-439)
 *
 * Eles saíram de dentro de `ModalDeMovimentacao` por uma razao de PROVA, a mesma
 * de `CamposDaConta` e `CamposDeLancamento`: o corpo do modal mora dentro de um
 * `Dialog` do Radix, que renderiza por PORTAL -- e portal nao sai no
 * `react-dom/server`. Medido aqui: `renderToStaticMarkup(<ModalDeMovimentacao>)`
 * devolve string de comprimento ZERO. Uma suite escrita sobre aquele markup
 * passaria verde afirmando "a tela mostra o campo em reais" E "a tela esconde a
 * quantidade" ao mesmo tempo, para qualquer codigo, inclusive para a tela de
 * antes desta issue.
 *
 * Com os campos aqui, `npm run test:aporte-de-renda-fixa` renderiza este
 * componente direto e mede o que a pessoa ve.
 */
export function CamposDaMovimentacao({
  ativos,
  valores,
  hoje,
  aoMudar: campo,
}: CamposDaMovimentacaoProps) {
  const ehProvento = valores.kind === "dividend";
  const ehRendaFixa = ehAtivoDeRendaFixa(ativos, valores.assetId);

  return (
    /* `grid-cols-1` explicito na base: um trilho `auto` tem o min-content
       como piso e cresce alem do container em vez de apertar, e foi assim
       que oito telas ganharam scroll horizontal no celular (HMO-168). */
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="lanc-ativo">Ativo *</Label>
        <Select
          value={valores.assetId}
          onValueChange={(v) => campo("assetId", v)}
        >
          <SelectTrigger id="lanc-ativo">
            <SelectValue placeholder="Escolha o ativo" />
          </SelectTrigger>
          <SelectContent>
            {ativos.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.symbol} — {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="lanc-kind">Movimentação *</Label>
        <Select
          value={valores.kind}
          onValueChange={(v) => campo("kind", v as InvestmentKind)}
        >
          <SelectTrigger id="lanc-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ROTULO_KIND) as InvestmentKind[]).map((k) => (
              <SelectItem key={k} value={k}>
                {ROTULO_KIND[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="lanc-data">
          {ehRendaFixa ? ROTULO_DATA_DA_RENDA_FIXA[valores.kind] : "Data"} *
        </Label>
        {/* `CampoDeData` e nao o controle de data nativo (HMO-240). O
            `max={hoje}` de antes valia para os dois caminhos do controle
            nativo; num campo de texto ele alcanca so o calendario, entao a
            recusa da data futura e explicita em quem grava -- ver
            `aoSalvar` na pagina. */}
        <CampoDeData
          id="lanc-data"
          value={valores.data}
          maxDoCalendario={hoje}
          onChange={(v) => campo("data", v)}
          required
          aria-label={
            ehRendaFixa
              ? ROTULO_DATA_DA_RENDA_FIXA[valores.kind]
              : "Data do lançamento"
          }
        />
      </div>

      {/* O CAMPO EM REAIS DO APORTE DE RENDA FIXA (HMO-439)
          ---------------------------------------------------
          Ele SUBSTITUI quantidade e preco unitario, e a substituicao e por
          MONTAGEM e nao por `hidden`/`className`: os dois campos de cota sao
          `required`, e um `required` vazio que o usuario nao pode ver nem
          alcancar faz o navegador barrar o submit sem dizer onde -- o botao
          que parece nao fazer nada, com o agravante de ser impossivel
          consertar pela tela.

          `CampoDeValor` e nao `<Input type="number">`: numero cru DESCARTA a
          virgula (`e.target.value` volta vazio em "10000,50") e em pt-BR
          isso apaga os centavos de quem digita como se fala. Ver
          lib/dinheiro.ts. */}
      {ehRendaFixa && (
        <div className="space-y-2">
          <Label htmlFor="lanc-valor-aporte">
            {ROTULO_VALOR_DA_RENDA_FIXA[valores.kind]} *
          </Label>
          <CampoDeValor
            id="lanc-valor-aporte"
            value={valores.valorDoAporte}
            onChange={(v) => campo("valorDoAporte", v)}
            required
            aria-label={ROTULO_VALOR_DA_RENDA_FIXA[valores.kind]}
          />
        </div>
      )}

      {!ehRendaFixa && (
        <div className="space-y-2">
          {/* POR QUE QUANTIDADE E COTACAO NAO LEVAM A MASCARA DE R$
              (HMO-171)

              A mascara de dinheiro tem as casas da MOEDA -- duas, em real.
              Estes campos tem oito (`step="0.00000001"`), e por um motivo:
              cripto e fracao de cota nao cabem em centavos.

              Mascarar aqui nao deixaria o campo feio, arredondaria o dado:
              um preco de 0,00000001 viraria R$ 0,01, um erro de um milhao de
              vezes, em silencio -- exatamente a classe de bug que a mascara
              foi criada para evitar. E quantidade de cotas nem e dinheiro;
              nao tem simbolo de moeda para levar.

              Se um dia a cotacao precisar de mascara, ela precisa de casas
              por CAMPO e nao por moeda, que e outra decisao. */}
          <Label htmlFor="lanc-quantidade">
            {ehProvento ? "Cotas *" : "Quantidade *"}
          </Label>
          <Input
            id="lanc-quantidade"
            type="number"
            step="0.00000001"
            min="0"
            value={valores.quantidade}
            onChange={(e) => campo("quantidade", e.target.value)}
            required
          />
        </div>
      )}

      {!ehRendaFixa && (
        <div className="space-y-2">
          <Label htmlFor="lanc-preco">
            {ehProvento ? "Valor por cota *" : "Preço unitário *"}
          </Label>
          <Input
            id="lanc-preco"
            type="number"
            step="0.00000001"
            min="0"
            value={valores.preco}
            onChange={(e) => campo("preco", e.target.value)}
            required
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="lanc-taxas">Taxas (opcional)</Label>
        {/* Taxa de corretagem e dinheiro comum, com duas casas: entra
            mascarado como todo campo de valor do app (HMO-171). Os campos
            de COTACAO acima nao -- ver o comentario deles. */}
        <CampoDeValor
          id="lanc-taxas"
          value={valores.taxas}
          onChange={(v) => campo("taxas", v)}
        />
      </div>
    </div>
  );
}

interface ModalDeMovimentacaoProps {
  ativos: AtivoParaLancar[];
  /** O ativo ja escolhido, quando a abertura veio do `+` de uma linha. */
  ativoInicial?: string;
  /** Hoje em AAAA-MM-DD: o padrao da data e o teto do calendario. */
  hoje: string;
  salvando: boolean;
  /** O X, o Esc, o clique fora e o Cancelar. */
  aoFechar: () => void;
  /**
   * Grava. Devolve a frase de erro, ou `null` quando gravou.
   *
   * O erro volta para CA e e mostrado DENTRO do modal de proposito: o `<Alert>`
   * de erro da pagina fica atras do overlay, entao uma recusa da rota ("preco
   * unitario invalido") seria invisivel para quem esta com o modal aberto -- e
   * o sintoma e o pior possivel, o botao que parece nao fazer nada.
   */
  aoSalvar: (valores: ValoresDaMovimentacao) => Promise<string | null>;
}

export function ModalDeMovimentacao({
  ativos,
  ativoInicial = "",
  hoje,
  salvando,
  aoFechar,
  aoSalvar,
}: ModalDeMovimentacaoProps) {
  const [valores, setValores] = useState<ValoresDaMovimentacao>(() =>
    valoresDaMovimentacaoVazios(hoje, ativoInicial)
  );
  const [continuar, setContinuar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const campo = <C extends keyof ValoresDaMovimentacao>(
    chave: C,
    valor: ValoresDaMovimentacao[C]
  ) => setValores((atual) => ({ ...atual, [chave]: valor }));

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);

    const frase = await aoSalvar(valores);
    if (frase) {
      setErro(frase);
      return;
    }

    if (continuar) {
      // O reset vive em lib/retorno-do-lancamento.ts -- ver o cabecalho.
      setValores((atual) =>
        proximaMovimentacaoDeCarteira(atual, valoresDaMovimentacaoVazios(hoje))
      );
      return;
    }

    aoFechar();
  }

  // RENDA FIXA TROCA OS CAMPOS DA TELA (HMO-439). A mesma leitura que
  // `CamposDaMovimentacao` faz, pela mesma funcao -- aqui ela decide a frase do
  // cabecalho e a do "Salvar e continuar", que NOMEIAM os campos.
  const ehRendaFixa = ehAtivoDeRendaFixa(ativos, valores.assetId);

  return (
    <ModalDeLancamento
      titulo="Lançar movimentação"
      descricao={
        ehRendaFixa
          ? "Renda fixa não tem cota: informe o valor em reais e a data. O rendimento não entra aqui — ele é calculado pelo indexador do papel."
          : "Compra, venda ou provento de um ativo da sua carteira. Em provento, a quantidade são as cotas que receberam e o valor é o valor por cota."
      }
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
        <CamposDaMovimentacao
          ativos={ativos}
          valores={valores}
          hoje={hoje}
          aoMudar={campo}
        />

        {/* Antes dos botoes: ele muda o que o botao de Lancar faz. */}
        <SalvarEContinuar
          ligado={continuar}
          aoMudar={setContinuar}
          disabled={salvando}
          // O apoio NOMEIA campos, e os desta tela sao outros -- ver
          // SalvarEContinuar. O padrao fala de descricao, categoria e conta,
          // que nao existem aqui. E em RENDA FIXA eles sao outros de novo
          // (HMO-439): prometer "quantidade e valor" numa tela que nao tem
          // quantidade manda a pessoa conferir um campo que nao existe -- e
          // cala justamente sobre o campo que ela precisa reler antes do
          // segundo clique.
          frases={{
            ligado: ehRendaFixa
              ? "A tela fica aberta para o próximo lançamento. O valor e as taxas são limpos; o ativo, o tipo e a data continuam."
              : "A tela fica aberta para a próxima movimentação. Quantidade, valor e taxas são limpos; o ativo, o tipo e a data continuam.",
            desligado: "Ao salvar, esta tela fecha e volta para a carteira.",
          }}
        />

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={salvando || !valores.assetId}>
            <Plus className="h-4 w-4 mr-1" />
            {salvando
              ? "Lançando..."
              : `Lançar ${ROTULO_KIND[valores.kind].toLowerCase()}`}
          </Button>
          {/* Mesmo caminho de saida do X e do Esc. */}
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
