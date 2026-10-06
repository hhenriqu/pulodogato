"use client";

// ---------------------------------------------------------------------------
// RENDA FIXA NA TELA (HMO-192, entrega 2 da HMO-141)
// ---------------------------------------------------------------------------
// Dois componentes, um de leitura e um de escrita:
//
//   RendaFixaDaCarteira  o rendimento de cada ativo -- BRUTO em destaque,
//                        LIQUIDO estimado ao lado (decisao fechada pelo Helio
//                        na HMO-192);
//   CamposDeRendaFixa    os seis campos da migration 031, usados tanto no
//                        cadastro de um ativo novo quanto no preenchimento de um
//                        ativo que ja existia antes dela.
//
// Nenhum numero e calculado aqui. Todos vem de GET /api/investments/renda-fixa,
// que e a condicao que a HMO-124 deixou escrita depois de achar a tela de
// investimentos mostrando R$ 55.000 de carteira que nunca existiram.
//
// POR QUE O LIQUIDO NAO PODE SER O NUMERO GRANDE
// -----------------------------------------------
// O liquido e uma ESTIMATIVA: ele supoe resgate hoje, e a aliquota muda de faixa
// com o tempo. O bruto e o que de fato aconteceu com o dinheiro. Inverter os dois
// faria a tela destacar o numero menos certo dos dois -- e, num isento, os dois
// numeros sao iguais e o destaque nao diria nada.
//
// A PALAVRA "ESTIMADO" NAO E DECORACAO
// ------------------------------------
// Ela e o que separa esta tela de um extrato. A projecao usa a taxa do CDI
// publicada e o percentual cadastrado; o banco do usuario arredonda, cobra
// custodia e aplica IOF nos primeiros 30 dias. Prometer o centavo exato de um
// extrato que nao temos e pior do que mostrar um numero honesto com a palavra ao
// lado.
// ---------------------------------------------------------------------------

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CampoDeData } from "@/components/ui/campo-de-data";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, TrendingUp } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  INDEXADORES,
  PRODUTOS,
  ROTULO_INDEXADOR,
  ROTULO_PRODUTO,
  faixaDeIr,
  type Indexador,
  type ProdutoRendaFixa,
  type Projecao,
} from "@/lib/renda-fixa";

export interface ResumoDeRendaFixa {
  bruto: number;
  liquido: number;
  porDia: number;
  semProjecao: number;
}

export interface RendaFixaDaRota {
  projections: Projecao[];
  summary: ResumoDeRendaFixa;
  hoje: string;
}

/**
 * A frase de cada motivo.
 *
 * Elas sao diferentes de proposito -- ver o tipo `MOTIVO` em lib/renda-fixa.ts.
 * "Tente mais tarde" num IPCA (que nunca vai ter projecao automatica) manda a
 * pessoa esperar por uma coisa que nao vai chegar; "preencha o indexador" num
 * timeout do Banco Central manda ela editar um ativo que esta certo.
 */
const FRASE_DO_MOTIVO: Record<string, string> = {
  sem_indexador:
    "Falta o indexador. Preencha abaixo para ver o rendimento sozinho.",
  sem_fonte:
    "Sem projeção automática para este indexador: IPCA e IGP-M são índices mensais e a poupança rende por aniversário. Informe o preço atual na mão.",
  sem_taxa: "Prefixado precisa da taxa ao ano (ex.: 13).",
  sem_prazo:
    "Falta a data de aplicação — e não há compra lançada para usar no lugar. Sem prazo não há alíquota de IR.",
  indisponivel:
    "Não consegui falar com o Banco Central agora. O rendimento aparece na próxima atualização.",
};

/** "110% do CDI", "IPCA + 6% a.a.", "Prefixado 13% a.a." */
export function rotuloDaRemuneracao(p: Projecao): string {
  const partes: string[] = [];
  if (p.indexador === "prefixado") {
    partes.push(ROTULO_INDEXADOR.prefixado);
    if (p.spreadAnual !== null) partes.push(`${p.spreadAnual}% a.a.`);
    return partes.join(" ");
  }
  if (p.indexador) {
    const indice = ROTULO_INDEXADOR[p.indexador];
    partes.push(
      p.percentualDoIndice !== null
        ? `${p.percentualDoIndice}% do ${indice}`
        : indice
    );
    if (p.spreadAnual) partes.push(`+ ${p.spreadAnual}% a.a.`);
  }
  return partes.join(" ");
}

function LinhaDaProjecao({ p }: { p: Projecao }) {
  const temNumero = p.motivo === null && p.bruto !== null && p.liquido !== null;

  return (
    <div className="space-y-2 border-b pb-4 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{p.symbol}</span>
        {p.produto && (
          <Badge variant="outline">{ROTULO_PRODUTO[p.produto]}</Badge>
        )}
        {p.indexador && (
          <Badge variant="secondary">{rotuloDaRemuneracao(p)}</Badge>
        )}
        {p.vencido && <Badge variant="outline">Vencido</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">{p.name}</p>

      {!temNumero ? (
        <p className="text-sm text-muted-foreground">
          {FRASE_DO_MOTIVO[p.motivo || "indisponivel"]}
        </p>
      ) : (
        <>
          {/* O par de numeros da issue: bruto grande, liquido ao lado. O
              `items-baseline` alinha as duas linhas de base em vez dos centros,
              que e o que faz o par ler como um numero e sua nota. */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-bold text-success">
              {formatCurrency(p.bruto as number)}
            </span>
            <span className="text-xs text-muted-foreground">bruto</span>
            <span className="text-base font-semibold text-foreground">
              {formatCurrency(p.liquido as number)}
            </span>
            <span className="text-xs text-muted-foreground">
              {/* Isento NAO mostra aliquota nenhuma. Imprimir "IR 0%" num
                  isento se le como "ainda nao calculei", e era justamente o
                  caso que a issue pediu para nao errar. */}
              {p.isento
                ? "líquido — isento de IR"
                : `líquido estimado, após ${p.aliquota}% de IR`}
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            {p.diasUteis === 0
              ? `Aplicado em ${formatDate(p.inicio as string)} — ainda sem dia útil fechado, então nada rendeu.`
              : `${p.diasUteis} dias úteis desde ${formatDate(p.inicio as string)} (${p.diasCorridos} corridos).`}
            {!p.isento && ` Alíquota de ${faixaDeIr(p.diasCorridos)}.`}
            {p.porDia !== null &&
              p.porDia > 0 &&
              ` Rende ${formatCurrency(p.porDia)} por dia útil.`}
          </p>

          {p.origemDoPrazo === "primeira_compra" && (
            <p className="text-xs text-muted-foreground">
              O prazo veio da sua primeira compra, não da data de aplicação —
              preencha a data abaixo para a alíquota sair do campo certo.
            </p>
          )}
          {p.vencido && (
            <p className="text-xs text-muted-foreground">
              A conta parou em {formatDate(p.fim as string)}, o vencimento. Papel
              vencido não rende mais.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * O card de renda fixa da carteira.
 *
 * Devolve `null` quando nao ha ativo de renda fixa: um card vazio dizendo
 * "R$ 0,00" numa carteira so de acoes e ruido, e ruido que parece defeito.
 */
export function RendaFixaDaCarteira({ dados }: { dados: RendaFixaDaRota | null }) {
  if (!dados || dados.projections.length === 0) return null;

  const { summary } = dados;
  const temAlgum = dados.projections.some((p) => p.motivo === null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Renda fixa
        </CardTitle>
        <CardDescription>
          O rendimento sai da taxa publicada pelo Banco Central e do percentual
          que você cadastrou. O líquido é estimado: ele supõe resgate hoje, e a
          alíquota de IR cai com o tempo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {temAlgum && (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md bg-muted p-3">
            <span className="text-xs text-muted-foreground">Total</span>
            <span className="text-2xl font-bold text-success">
              {formatCurrency(summary.bruto)}
            </span>
            <span className="text-xs text-muted-foreground">bruto</span>
            <span className="text-base font-semibold text-foreground">
              {formatCurrency(summary.liquido)}
            </span>
            <span className="text-xs text-muted-foreground">
              líquido estimado
            </span>
            {summary.porDia > 0 && (
              <span className="text-xs text-muted-foreground">
                · {formatCurrency(summary.porDia)} por dia útil
              </span>
            )}
          </div>
        )}

        {summary.semProjecao > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {summary.semProjecao === 1
                ? "Um ativo ficou fora do total"
                : `${summary.semProjecao} ativos ficaram fora do total`}{" "}
              — o motivo está na linha de cada um. O total soma só o que foi
              possível projetar.
            </AlertDescription>
          </Alert>
        )}

        {dados.projections.map((p) => (
          <LinhaDaProjecao key={p.asset_id} p={p} />
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Os seis campos da 031
// ---------------------------------------------------------------------------

export interface ValoresDeRendaFixa {
  fixedIncomeProduct: string;
  indexKind: string;
  indexPercentage: string;
  spreadAnnual: string;
  appliedDate: string;
  maturityDate: string;
}

export function valoresDeRendaFixaVazios(): ValoresDeRendaFixa {
  return {
    fixedIncomeProduct: "",
    indexKind: "",
    indexPercentage: "",
    spreadAnnual: "",
    appliedDate: "",
    maturityDate: "",
  };
}

/** O que vai no corpo da requisicao: `""` vira `null`, que limpa a coluna. */
export function corpoDeRendaFixa(v: ValoresDeRendaFixa) {
  return {
    fixedIncomeProduct: v.fixedIncomeProduct || null,
    indexKind: v.indexKind || null,
    indexPercentage: v.indexPercentage === "" ? null : v.indexPercentage,
    spreadAnnual: v.spreadAnnual === "" ? null : v.spreadAnnual,
    appliedDate: v.appliedDate || null,
    maturityDate: v.maturityDate || null,
  };
}

/**
 * Os seis campos, em grade. Usado no cadastro e na edicao.
 *
 * O percentual e o spread NAO usam a mascara de R$ (`CampoDeValor`): nenhum dos
 * dois e dinheiro, e a mascara de moeda transformaria "110" em "R$ 1,10". E
 * `type="number"` com `step` em vez de texto livre porque `input type=number`
 * descarta a virgula de "110,5" em silencio -- ver o `step` de cada um.
 */
export function CamposDeRendaFixa({
  idPrefixo,
  valores,
  onChange,
  desabilitado,
}: {
  idPrefixo: string;
  valores: ValoresDeRendaFixa;
  onChange: (v: ValoresDeRendaFixa) => void;
  desabilitado?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const mudar = (campo: keyof ValoresDeRendaFixa, valor: string) =>
    onChange({ ...valores, [campo]: valor });

  const prefixado = valores.indexKind === "prefixado";

  return (
    <div className="space-y-4 sm:col-span-2 lg:col-span-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefixo}-produto`}>Produto</Label>
          <Select
            value={valores.fixedIncomeProduct}
            onValueChange={(v) => mudar("fixedIncomeProduct", v)}
            disabled={desabilitado}
          >
            <SelectTrigger id={`${idPrefixo}-produto`}>
              <SelectValue placeholder="CDB, LCI..." />
            </SelectTrigger>
            <SelectContent>
              {PRODUTOS.map((p) => (
                <SelectItem key={p} value={p}>
                  {ROTULO_PRODUTO[p as ProdutoRendaFixa]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            LCI, LCA, CRI, CRA e poupança são isentas de IR — é o produto que
            decide isso, não o indexador.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefixo}-indexador`}>Indexador</Label>
          <Select
            value={valores.indexKind}
            onValueChange={(v) => mudar("indexKind", v)}
            disabled={desabilitado}
          >
            <SelectTrigger id={`${idPrefixo}-indexador`}>
              <SelectValue placeholder="CDI, prefixado..." />
            </SelectTrigger>
            <SelectContent>
              {INDEXADORES.map((i) => (
                <SelectItem key={i} value={i}>
                  {ROTULO_INDEXADOR[i as Indexador]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Prefixado nao tem percentual de indice -- o CHECK da 031 proibe, e a
            taxa inteira dele mora no campo ao lado. Esconder e melhor que
            desabilitar: um campo cinza convida a pessoa a tentar descobrir por
            que ele nao aceita o numero dela. */}
        {!prefixado && (
          <div className="space-y-2">
            <Label htmlFor={`${idPrefixo}-percentual`}>
              % do índice
            </Label>
            <Input
              id={`${idPrefixo}-percentual`}
              type="number"
              step="0.0001"
              min="0"
              max="1000"
              placeholder="110"
              value={valores.indexPercentage}
              onChange={(e) => mudar("indexPercentage", e.target.value)}
              disabled={desabilitado}
            />
            <p className="text-xs text-muted-foreground">
              110 = 110% do CDI. Em branco vale 100%.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor={`${idPrefixo}-spread`}>
            {prefixado ? "Taxa ao ano" : "+ % ao ano"}
          </Label>
          <Input
            id={`${idPrefixo}-spread`}
            type="number"
            step="0.0001"
            min="0"
            max="100"
            placeholder={prefixado ? "13" : "0"}
            value={valores.spreadAnnual}
            onChange={(e) => mudar("spreadAnnual", e.target.value)}
            disabled={desabilitado}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefixo}-aplicacao`}>Data de aplicação</Label>
          <CampoDeData
            id={`${idPrefixo}-aplicacao`}
            value={valores.appliedDate}
            onChange={(v) => mudar("appliedDate", v)}
            disabled={desabilitado}
          />
          <p className="text-xs text-muted-foreground">
            É ela que decide a alíquota de IR (22,5% até 180 dias, caindo a 15%
            acima de 720).
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefixo}-vencimento`}>Vencimento</Label>
          <CampoDeData
            id={`${idPrefixo}-vencimento`}
            value={valores.maturityDate}
            onChange={(v) => mudar("maturityDate", v)}
            disabled={desabilitado}
          />
          <p className="text-xs text-muted-foreground">
            Em branco para liquidez diária.
          </p>
        </div>
      </div>

      <button
        type="button"
        className="text-xs text-muted-foreground underline"
        onClick={() => setAberto(!aberto)}
      >
        {aberto ? "Esconder" : "Como o rendimento é calculado"}
      </button>
      {aberto && (
        <p className="text-xs text-muted-foreground">
          A taxa diária vem da série 12 do Banco Central (CDI) ou da 11 (Selic),
          de graça e sem cadastro, e capitaliza só em dia útil — sábado e feriado
          não rendem. O percentual multiplica a taxa do dia: 110% do CDI é
          1 + 0,050788% × 1,10 por dia útil. O IR incide só sobre o rendimento, e
          a alíquota sai dos dias corridos desde a aplicação.
        </p>
      )}
    </div>
  );
}
