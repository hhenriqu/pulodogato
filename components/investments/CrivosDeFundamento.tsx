"use client";

// A lista de criterios de fundamento (HMO-195).
//
// O QUE ESTA TELA E, E O QUE ELA NAO E
// ------------------------------------
// E uma lista: criterio, o valor da empresa, e se bateu. Nao ha nota unica, nao
// ha "2 de 3", nao ha estrela, nao ha as palavras comprar, vender ou
// recomendado. A trava disso nao e este comentario -- e `VOCABULARIO_PROIBIDO`
// em lib/crivos.ts, varrido contra o HTML que este arquivo produz pela suite
// `npm run test:crivos`.
//
// O limite e DO USUARIO. O app nao afirma que 15% de ROE e bom; ele mostra se o
// criterio que a pessoa escolheu bateu. Por isso os tres campos no topo, e por
// isso eles mudam a lista enquanto sao digitados, antes de salvar.
//
// POR QUE OS ESTADOS SAO TRES E NAO DOIS
// --------------------------------------
// "Sem dado no balanco" nao e uma forma polida de "nao atingido". A view devolve
// NULL de proposito onde a conta nao tem leitura correta (ROE de empresa com
// patrimonio negativo, alavancagem de quem nao publicou divida), e em JavaScript
// `null > 15` e `false` -- a linguagem entrega calada exatamente a mentira que o
// SQL se recusa a entregar. Num crivo de divida, tratar ausencia como zero
// APROVA a empresa sobre a qual nao se sabe nada.
//
// E por isso tambem que ativo fora dos crivos (FII, renda fixa, internacional,
// ou acao cujo balanco ainda nao foi importado) recebe FRASE e nao campo vazio:
// vazio se le como "ainda carregando" ou como zero.

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, ListChecks } from "lucide-react";
import {
  CRIVOS,
  CRIVOS_PENDENTES,
  ROTULO_DO_ESTADO,
  formatarDataBase,
  formatarLimite,
  formatarValorDoCrivo,
  limitesEfetivos,
  montarCrivosDaCarteira,
  textosIniciais,
  type AtivoComCrivos,
  type AtivoParaCrivos,
  type AvaliacaoDeCrivo,
  type EstadoDoCrivo,
  type LimitesDosCrivos,
  type LinhaDeIndicadores,
} from "@/lib/crivos";

/** O que GET /api/investments/crivos devolve. */
export interface DadosDosCrivos {
  ativos: AtivoParaCrivos[];
  indicadores: LinhaDeIndicadores[];
  limites: LimitesDosCrivos;
  fonteIndisponivel: boolean;
}

/**
 * A cor de cada estado sai de token, e os tres sao DIFERENTES entre si.
 *
 * "Sem dado" nao usa a cor de reprovado: quem le a tela de relance le a cor
 * antes da palavra, e pintar ausencia de dado como reprovacao desfaz no olho o
 * terceiro estado que o resto do codigo existe para manter.
 */
const CLASSE_DO_ESTADO: Record<EstadoDoCrivo, string> = {
  atingido: "border-success bg-success/10 text-success",
  nao_atingido: "border-destructive bg-destructive/10 text-destructive",
  sem_dado: "border-border bg-muted text-muted-foreground",
};

function Selo({ estado }: { estado: EstadoDoCrivo }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${CLASSE_DO_ESTADO[estado]}`}
    >
      {ROTULO_DO_ESTADO[estado]}
    </span>
  );
}

function LinhaDeCrivo({ avaliacao }: { avaliacao: AvaliacaoDeCrivo }) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b py-3 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-start">
      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium">{avaliacao.rotulo}</span>
          <span className="text-sm text-muted-foreground">
            seu critério: {avaliacao.criterio}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{avaliacao.explicacao}</p>
        {/* A fonte fica na linha do indicador, e nao no rodape do card, porque a
            regra e "uma fonte POR indicador" -- um rodape unico voltaria a
            sugerir que os tres numeros vieram do mesmo lugar por acaso. */}
        <p className="text-xs text-muted-foreground">{avaliacao.fonte}</p>
      </div>

      <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
        <span className="text-lg font-semibold tabular-nums">
          {formatarValorDoCrivo(avaliacao.valor, avaliacao.unidade)}
        </span>
        <Selo estado={avaliacao.estado} />
      </div>
    </div>
  );
}

/**
 * Um ativo: ou os criterios, ou a frase que explica por que nao ha criterios.
 *
 * Nunca os dois, e nunca nenhum dos dois -- a lista vazia sem frase e o defeito
 * que a issue nomeia.
 */
export function BlocoDoAtivo({ ativo }: { ativo: AtivoComCrivos }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-semibold">{ativo.symbol}</span>
          <span className="text-sm text-muted-foreground">{ativo.name}</span>
        </div>

        {ativo.foraDosCrivos === null && (
          <p className="text-xs text-muted-foreground">
            {ativo.denominacao ? `${ativo.denominacao} — ` : ""}
            balanço de {ativo.anoExercicio ?? "—"}, data-base{" "}
            {formatarDataBase(ativo.dataBase)}
          </p>
        )}
      </div>

      {ativo.explicacao !== null ? (
        <p className="mt-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">
          {ativo.explicacao}
        </p>
      ) : (
        <div className="mt-2">
          {ativo.avaliacoes.map((avaliacao) => (
            <LinhaDeCrivo key={avaliacao.id} avaliacao={avaliacao} />
          ))}
        </div>
      )}
    </div>
  );
}

export interface CrivosDeFundamentoProps {
  dados: DadosDosCrivos;
  /**
   * Grava os limites. Fica de fora do componente de proposito: a chamada de rede
   * mora na pagina, e assim a suite pode renderizar este arquivo no node sem
   * `fetch`.
   */
  onSalvar?: (
    limites: LimitesDosCrivos
  ) => Promise<{ ok: boolean; erro?: string }>;
}

export function CrivosDeFundamento({ dados, onSalvar }: CrivosDeFundamentoProps) {
  const [textos, setTextos] = useState<Record<string, string>>(() =>
    textosIniciais(dados.limites)
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  // O limite que vale AGORA na tela: o digitado quando da para ler, o salvo
  // quando nao da. Campo apagado no meio da digitacao nao volta para o padrao de
  // fabrica -- ver `limitesEfetivos`.
  const limites = limitesEfetivos(textos, dados.limites);

  const blocos = montarCrivosDaCarteira(
    dados.ativos,
    dados.indicadores,
    limites,
    dados.fonteIndisponivel
  );

  // O que esta gravado, passado pela MESMA normalizacao: comparar contra o
  // `dados.limites` cru daria "nao salvo" para todo usuario cujo jsonb nao tem a
  // chave ainda -- `undefined !== 15` e verdadeiro, e o aviso apareceria na
  // primeira abertura, sem ninguem ter digitado nada.
  const salvos = limitesEfetivos({}, dados.limites);
  const naoSalvo = CRIVOS.some((crivo) => limites[crivo.id] !== salvos[crivo.id]);

  async function salvar() {
    if (!onSalvar) return;
    setSalvando(true);
    setErro(null);
    setSalvo(false);
    try {
      const resultado = await onSalvar(limites);
      if (resultado.ok) setSalvo(true);
      else setErro(resultado.erro || "Não foi possível salvar os seus critérios");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="h-5 w-5" />
          Critérios de fundamento
        </CardTitle>
        <CardDescription>
          Os limites são seus: o app mostra se o seu critério bateu, e não opina
          sobre o ativo. Os números saem do último balanço anual que cada empresa
          entregou à CVM, e a data-base aparece em cada ativo.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* --- Os limites, editaveis ---------------------------------------- */}
        <div className="space-y-3">
          {/* `grid-cols-1` explicito na base: um trilho `auto` tem o min-content
              como piso e cresce alem do container em vez de apertar (HMO-168). */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {CRIVOS.map((crivo) => (
              <div key={crivo.id} className="space-y-2">
                <Label htmlFor={`limite-${crivo.id}`} className="text-xs">
                  {crivo.rotulo} — {crivo.direcao} de
                </Label>
                <Input
                  id={`limite-${crivo.id}`}
                  type="number"
                  step="0.1"
                  min={crivo.limiteMinimo}
                  max={crivo.limiteMaximo}
                  inputMode="decimal"
                  value={textos[crivo.id] ?? ""}
                  onChange={(e) =>
                    setTextos((atual) => ({
                      ...atual,
                      [crivo.id]: e.target.value,
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  valendo agora: {formatarLimite(limites[crivo.id], crivo.unidade)}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {onSalvar && (
              <Button onClick={salvar} disabled={salvando} variant="outline">
                Salvar meus critérios
              </Button>
            )}
            {naoSalvo && (
              <span className="text-xs text-muted-foreground">
                A lista abaixo já usa o limite digitado. Salve para que ele valha
                na próxima vez que você abrir esta tela.
              </span>
            )}
            {salvo && !naoSalvo && (
              <span className="text-xs text-muted-foreground">
                Critérios salvos.
              </span>
            )}
          </div>

          {erro && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{erro}</AlertDescription>
            </Alert>
          )}
        </div>

        {/* --- A lista, ativo por ativo ------------------------------------- */}
        {blocos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Cadastre um ativo para ver os critérios dele.
          </p>
        ) : (
          <div className="space-y-4">
            {blocos.map((bloco) => (
              <BlocoDoAtivo key={bloco.assetId} ativo={bloco} />
            ))}
          </div>
        )}

        {/* --- O crivo que esta entrega nao fecha, dito em voz alta --------- */}
        <div className="space-y-2 border-t pt-4">
          {CRIVOS_PENDENTES.map((pendente) => (
            <p key={pendente.id} className="text-xs text-muted-foreground">
              <span className="font-medium">{pendente.rotulo}:</span>{" "}
              {pendente.motivo}
            </p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
