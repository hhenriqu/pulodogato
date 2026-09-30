"use client";

// ---------------------------------------------------------------------------
// O CAMPO DA COTACAO DO DIA DA COMPRA (HMO-182)
// ---------------------------------------------------------------------------
// Aparece so quando a moeda do lancamento nao e real. A decisao do Helio foi
// `ptax_editavel`: o numero vem do Banco Central e ele pode corrigir.
//
// A REGRA DE PREENCHIMENTO, QUE E A PARTE QUE PODE DAR ERRADO
// -----------------------------------------------------------
// A busca automatica so preenche CAMPO VAZIO. Nunca sobrescreve o que ja esta
// la. Isso resolve dois casos que uma busca mais "esperta" estragaria, e os dois
// custam dinheiro:
//
//   1. edicao de um lancamento antigo. A cotacao gravada e a do dia da compra --
//      o motivo de a issue existir ("usar o cambio de hoje faria o valor do
//      passado mudar sozinho"). Um efeito que rebuscasse ao abrir a tela
//      reescreveria o historico a cada edicao;
//   2. correcao manual. Quem digitou a taxa do extrato do cartao (com spread e
//      IOF, que e o numero real que ele pagou) nao pode ver isso ser trocado
//      pela PTAX porque mudou a data num campo vizinho.
//
// Quem limpa o campo -- e portanto autoriza uma nova busca -- e a troca de
// MOEDA, no componente pai: a cotacao do dolar nao significa nada para o euro.
// Para o resto existe o botao de buscar, explicito.
//
// E quando a cotacao carregada veio de outra data que nao a da compra, o rodape
// DIZ de que data ela e. Sem isso a tela exibiria um numero de aparencia exata
// que nao corresponde ao dia do lancamento, e ninguem teria como notar.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { moedaPorCodigo } from "@/lib/dinheiro";
import {
  type OrigemDaCotacao,
  cotacaoDigitada,
  ptaxCobre,
  valorEmReais,
} from "@/lib/cambio";

interface Props {
  /** A moeda do lancamento. BRL nao renderiza nada. */
  moeda: string;
  /** A data da compra, YYYY-MM-DD. E ela que define QUAL cotacao buscar. */
  data: string;
  /** O que esta no campo, como texto. */
  cotacao: string;
  /** O valor do lancamento, so para mostrar o equivalente em reais. */
  valor: string;
  aoMudar: (cotacao: string) => void;
}

interface RespostaDoCambio {
  taxa: number | null;
  dataDoBoletim: string | null;
  origem: OrigemDaCotacao;
  mensagem?: string;
}

export function CampoDeCotacao({
  moeda,
  data,
  cotacao,
  valor,
  aoMudar,
}: Props) {
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [dataDoBoletim, setDataDoBoletim] = useState<string | null>(null);

  // A ultima combinacao (moeda, data) que JA foi buscada. Sem isto o efeito
  // dispara de novo a cada tecla digitada no campo -- `cotacao` muda, o efeito
  // reavalia, e uma cotacao apagada com backspace viraria uma rajada de
  // requisicoes ao Banco Central no meio da digitacao.
  const jaBuscado = useRef<string | null>(null);

  const buscar = useCallback(
    async (forcado: boolean) => {
      if (!moeda || moeda === "BRL") return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return;

      const chave = `${moeda}|${data}`;
      if (!forcado && jaBuscado.current === chave) return;
      jaBuscado.current = chave;

      setBuscando(true);
      try {
        const r = await fetch(
          `/api/cambio?moeda=${encodeURIComponent(
            moeda
          )}&data=${encodeURIComponent(data)}`
        );
        // A rota nao tem 5xx de proposito (ver app/api/cambio/route.ts). Um
        // status ruim aqui e 401 de sessao vencida ou 400 de chamada errada --
        // nos dois o campo continua digitavel, que e o contrato.
        if (!r.ok) {
          setAviso("Não consegui buscar a cotação. Informe o valor.");
          return;
        }
        const corpo = (await r.json()) as RespostaDoCambio;

        setDataDoBoletim(corpo.dataDoBoletim ?? null);
        setAviso(corpo.mensagem ?? null);

        // So preenche vazio. Ver o cabecalho: sobrescrever aqui reescreveria a
        // cotacao do passado numa edicao, ou apagaria uma correcao manual.
        if (corpo.taxa !== null && (forcado || cotacao.trim() === "")) {
          aoMudar(String(corpo.taxa));
        }
      } catch {
        setAviso("Não consegui buscar a cotação. Informe o valor.");
      } finally {
        setBuscando(false);
      }
    },
    // `cotacao` entra como leitura, nao como gatilho -- o gatilho e (moeda,
    // data), e `jaBuscado` e quem garante isso.
    [moeda, data, cotacao, aoMudar]
  );

  useEffect(() => {
    if (!moeda || moeda === "BRL") return;
    if (cotacao.trim() !== "") {
      // Campo ja preenchido (edicao, ou digitado): nao busco, mas tambem nao
      // deixo a chave em branco -- senao apagar o campo com backspace dispararia
      // a busca no meio da digitacao.
      jaBuscado.current = `${moeda}|${data}`;
      return;
    }
    void buscar(false);
  }, [moeda, data, cotacao, buscar]);

  if (!moeda || moeda === "BRL") return null;

  const taxa = cotacaoDigitada(cotacao);
  const numero = Number.parseFloat(String(valor).replace(",", "."));
  const simbolo = moedaPorCodigo(moeda)?.simbolo ?? moeda;

  // O boletim veio de outra data que nao a da compra? A pessoa precisa saber --
  // e o unico jeito de "5,2132" nao passar por exato quando e de outro dia.
  const deOutraData = Boolean(dataDoBoletim && dataDoBoletim !== data);

  return (
    <div className="space-y-2 pt-1">
      <Label htmlFor="lancamento-cotacao">
        Cotação de 1 {moeda} em reais, na data da compra
      </Label>

      <div className="flex gap-2">
        <Input
          id="lancamento-cotacao"
          inputMode="decimal"
          placeholder={ptaxCobre(moeda) ? "buscando..." : "ex.: 0,0007"}
          value={cotacao}
          onChange={(e) => aoMudar(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => void buscar(true)}
          disabled={buscando || !ptaxCobre(moeda)}
          // Sem cobertura na PTAX o botao nao tem o que fazer: desabilitado e
          // honesto, e o texto do rodape explica que nao e falha temporaria.
          title={
            ptaxCobre(moeda)
              ? "Buscar a PTAX do Banco Central"
              : `O Banco Central não publica PTAX de ${moeda}`
          }
        >
          {buscando ? "..." : "Buscar"}
        </Button>
      </div>

      {/* O equivalente em reais, que e o numero que vai para o acerto do grupo e
          para a barra do orcamento. Mostrar aqui e o que transforma um erro de
          digitacao (5 no lugar de 0,5) em algo visivel ANTES de salvar: a
          cotacao errada por uma ordem de grandeza parece plausivel isolada, e o
          total convertido nao. */}
      {taxa !== null && Number.isFinite(numero) && numero > 0 && (
        <p className="text-xs text-muted-foreground">
          {simbolo} {numero.toLocaleString("pt-BR")} ={" "}
          <strong>
            R${" "}
            {valorEmReais(numero, taxa).toLocaleString("pt-BR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </strong>
        </p>
      )}

      {aviso && (
        <p
          className={
            deOutraData ? "text-xs text-warning" : "text-xs text-muted-foreground"
          }
        >
          {aviso}
        </p>
      )}
    </div>
  );
}
