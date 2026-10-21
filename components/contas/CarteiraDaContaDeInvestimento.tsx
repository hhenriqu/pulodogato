"use client";

// ---------------------------------------------------------------------------
// AS TRES LINHAS DO CARTAO DA CONTA INVESTIMENTO (HMO-438, F4 da HMO-432)
// ---------------------------------------------------------------------------
// A Fase 3 fez a carteira atrelada SUBSTITUIR o saldo digitado da Conta
// Investimento (Decisao 1A do plano). Dinheiro deixando de contar sem nada na
// tela dizendo isso e a pior metade dessa decisao: o total do patrimonio muda, o
// cartao continua mostrando um numero, e a pessoa nao tem como descobrir qual
// dos dois o app usou. Este bloco e a outra metade.
//
// AS TRES LINHAS
// --------------
//   aplicado         o custo das posicoes abertas atreladas a esta conta
//   rendimento       o que a renda fixa rendeu, bruto, ja contado no valor
//   saldo informado  o `current_balance` digitado -- INFORMACAO, nao valor
//
// QUAL DELAS CONTA, E POR QUE ISSO NAO PODE FICAR NA DIAGRAMACAO
// -------------------------------------------------------------
// A que conta e `aplicado + rendimento`, e ela e o NUMERO GRANDE do cartao --
// quem troca o headline e a tela de contas, que e dona dele (ver o `valor` do
// cartao em app/(dashboard)/dashboard/contas/page.tsx). Este bloco e a abertura
// desse numero, e por isso as duas primeiras linhas carregam
// `data-entra-no-patrimonio="sim"` e a terceira, `"nao"` -- as duas afirmacoes
// em voz alta, nenhuma por omissao.
//
// Tres numeros empilhados, um deles irrelevante, sem nada dizendo qual, e
// exatamente o estado que faz alguem somar os tres a mao e concluir que o app
// errou. A frase "nao entra no patrimonio" na linha do saldo informado e o que
// impede isso, e ela e TEXTO -- nao uma cor nem uma opacidade, que nao
// sobrevivem a quem le a tela em preto e branco ou por leitor de tela.
//
// POR QUE O SALDO INFORMADO NAO E SIMPLESMENTE ESCONDIDO
// -----------------------------------------------------
// Porque ele e a UNICA evidencia de que a substituicao aconteceu. Quem mantinha
// o saldo na mao descobre, olhando as duas linhas lado a lado, que o numero
// dele estava defasado -- e e esse o ganho da feature. Escondido, o cartao
// ficaria indistinguivel do cartao de uma conta sem ativo atrelado, e a
// diferenca entre esses dois estados e justamente o que a issue pede para
// mostrar. (E `hidden` nao resolveria nada de todo jeito: o texto continua no
// `textContent`.)
//
// A DATA E `updated_at`, E ELA NAO E UM CARIMBO DE SALDO
// -----------------------------------------------------
// Nao existe coluna "quando o saldo foi informado" em `financial_accounts`, e
// inventar uma aqui pediria migration -- que nesta fase nao cabe (migration vai
// para main sozinha). `updated_at` e o que existe: o instante em que a LINHA da
// conta mudou pela ultima vez. Isso cobre a mudanca de saldo (que vem por
// trigger) e tambem a troca de nome ou de cor, entao o rotulo diz "atualizada
// em" -- a frase que o dado sustenta -- e nao "saldo informado em", que seria
// uma promessa que a coluna nao cumpre. Ver
// `flag-de-opt-out-nao-se-inventaria-pelo-nome-da-coluna`.
//
// SEM ICONE E SEM `lucide-react`, DE PROPOSITO
// --------------------------------------------
// A sonda de navegador (`npm run test:conta-investimento-na-tela`) monta este
// componente de verdade, e cada import novo dele e um esboco novo na sonda --
// ou um `ReferenceError` que nao se le como o que e
// (`import-novo-no-componente-derruba-a-sonda-de-navegador`). O bloco e texto e
// numero; nao ha nada aqui que um icone esclareca.
// ---------------------------------------------------------------------------

import { formatarValor } from "@/lib/dinheiro";
import { dataOuMomentoNaTela } from "@/lib/data-na-tela";

/**
 * O que a carteira desta conta vale, nas parcelas que a formam.
 *
 * Estruturalmente compativel com `CarteiraDaConta` de `@/lib/investments` -- e
 * declarado aqui, com so os campos que o bloco usa, para a sonda e o `tsc` do
 * teste nao arrastarem aquele arquivo inteiro (que e grande, tem ancora de
 * mutante, e carrega um NUL literal que faz o git ver o arquivo como binario).
 */
export interface ParcelasDaCarteira {
  /** `principal + rendimento`: o que ENTRA no patrimonio. E o numero grande. */
  valor: number;
  /** O custo das posicoes abertas desta conta -- a linha "Aplicado". */
  principal: number;
  /** O rendimento bruto de renda fixa ja contado no `valor`. */
  rendimento: number;
  /** Posicoes de renda fixa que entraram SEM rendimento. */
  semRendimento: number;
}

interface CarteiraDaContaDeInvestimentoProps {
  /** `null` = esta conta nao tem ativo atrelado. O bloco nao aparece. */
  carteira: ParcelasDaCarteira | null;
  /** O `current_balance` digitado. Entra como informacao, nao como valor. */
  saldoInformado: number;
  /** `financial_accounts.updated_at`. Ver o cabecalho. */
  atualizadaEm?: string | null;
  moeda?: string;
  /**
   * A rota do rendimento nao respondeu: a renda fixa esta avaliada pelo CUSTO.
   *
   * Vem de fora (da composicao da tela) porque e um estado da REQUISICAO e nao
   * desta conta -- quando o SGS cai, cai para todas.
   */
  rendimentoIndisponivel?: boolean;
}

/**
 * Uma linha rotulo/valor.
 *
 * `entra` vira `data-entra-no-patrimonio`, e e a ancora que a sonda le: uma
 * assercao sobre o TEXTO da linha continuaria verde com o rotulo apagado,
 * porque "Aplicado" e o valor em reais aparecem em outros lugares do cartao.
 */
function Linha({
  rotulo,
  valor,
  nota,
  ancora,
  entra,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  ancora: string;
  entra: "sim" | "nao";
}) {
  return (
    // `min-w-0` no rotulo e `shrink-0` no valor: e a receita que a HMO-185
    // mediu em producao. Sem ela a linha vaza para fora do cartao no iPhone,
    // porque o piso de min-content da linha cresce com o texto e nao ha largura
    // de celular que baste. Medido em PIXELS pela sonda, em 390 e em 320.
    <div
      data-linha={ancora}
      data-entra-no-patrimonio={entra}
      className="flex items-baseline justify-between gap-2"
    >
      <span className="min-w-0 text-xs text-muted-foreground">
        <span className="block truncate">{rotulo}</span>
        {nota ? <span className="block">{nota}</span> : null}
      </span>
      <span
        data-valor={ancora}
        className="shrink-0 text-sm tabular-nums text-foreground"
      >
        {valor}
      </span>
    </div>
  );
}

export function CarteiraDaContaDeInvestimento({
  carteira,
  saldoInformado,
  atualizadaEm,
  moeda,
  rendimentoIndisponivel,
}: CarteiraDaContaDeInvestimentoProps) {
  // CONTA SEM ATIVO ATRELADO NAO MUDA. A issue exige que o cartao dela fique
  // IDENTICO ao de hoje, e o jeito de cumprir isso e nao renderizar nada --
  // nao uma versao mais discreta do bloco.
  if (!carteira) return null;

  const dataDoSaldo = dataOuMomentoNaTela(atualizadaEm);

  return (
    <div data-carteira-da-conta="sim" className="space-y-2 border-t pt-3">
      <Linha
        ancora="aplicado"
        entra="sim"
        rotulo="Aplicado"
        valor={formatarValor(carteira.principal, moeda)}
      />
      <Linha
        ancora="rendimento"
        entra="sim"
        rotulo="Rendimento"
        nota={
          // As DUAS frases existem porque os dois estados dao `rendimento: 0`
          // e pedem coisas diferentes de quem le: uma e "o Banco Central nao
          // respondeu, volte depois", a outra e "falta preencher o indexador
          // deste papel". Ver o cabecalho de lib/carteira-na-tela.ts.
          rendimentoIndisponivel
            ? "sem o boletim do Banco Central: avaliado pelo custo"
            : carteira.semRendimento > 0
              ? "um papel ainda não rende: confira o indexador"
              : undefined
        }
        valor={formatarValor(carteira.rendimento, moeda)}
      />
      {/* O SALDO INFORMADO vem por ULTIMO de proposito: a ordem da leitura e
          "isto e o que vale, aquilo e o que voce havia anotado". */}
      <Linha
        ancora="saldo-informado"
        entra="nao"
        rotulo="Saldo informado"
        nota={
          dataDoSaldo
            ? `não entra no patrimônio · atualizada em ${dataDoSaldo}`
            : "não entra no patrimônio"
        }
        valor={formatarValor(saldoInformado, moeda)}
      />
    </div>
  );
}
