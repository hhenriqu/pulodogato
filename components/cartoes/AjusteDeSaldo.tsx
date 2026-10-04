"use client";

// ---------------------------------------------------------------------------
// O AJUSTE DE SALDO DA FATURA, NA TELA DO CARTAO (HMO-253)
// ---------------------------------------------------------------------------
// "Possibilidade de lancar um ajuste de saldo para que a fatura fique igual a
// real sem ter que discriminar o que foi o gasto."
//
// SEM `fetch` E SEM HOOK DE DADOS, pelo mesmo motivo que `FaturaDoCartao` e
// `CamposDeLancamento`: so assim o teste renderiza a tela de verdade com
// `react-dom/server` e afirma sobre o HTML que sai. Quem fala com
// `/api/card-invoices/ajuste` e a pagina.
//
// AS TRES COISAS QUE ESTE BLOCO NAO PODE FAZER
// --------------------------------------------
//   1. Imprimir numero sem ter conseguido ler. Todo valor passa por
//      `podeMostrarNumero()`, igual ao resto da tela.
//   2. Dizer "esta fatura nao tem ajuste" sem ter conseguido conferir. A
//      resposta da rota distingue "a consulta falhou" (campo ausente) de "nao
//      ha ajuste" (`null`), e `podeConferirAjuste` e o pedagio. Sem ele, o
//      bloco ofereceria "Ajustar saldo" sobre uma fatura JA ajustada.
//   3. Mostrar a previa com o mes de fora. "A fatura passa de X para Y" sem
//      dizer QUAL fatura e um numero certo respondendo uma pergunta que o
//      leitor nao sabe qual e -- o mesmo defeito que o total da fatura evita
//      andando junto do rotulo do mes.
//
// POR QUE O SINAL E UMA ESCOLHA, E NAO UM "-" DIGITADO
// ---------------------------------------------------
// `CampoDeValor` e uma mascara de DIGITOS: ela nao aceita "-" e nunca aceitou.
// Pedir "-50" no unico campo que recusa sinal daria um formulario que engole a
// digitacao. Dois botoes tambem imprimem na tela o que vai acontecer, o que um
// "-50" no meio de uma mascara nao faz.
// ---------------------------------------------------------------------------

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CampoDeValor } from "@/components/ui/campo-de-valor";
import { Scale } from "lucide-react";
import { formatarValor } from "@/lib/dinheiro";
import { podeMostrarNumero, type EstadoDaLeitura } from "@/lib/offline-leitura";
import { NumeroIndisponivel } from "@/components/SemRede";
import {
  podeConferirAjuste,
  totalComOAjuste,
  validarAjuste,
  type CategoriaDeAjuste,
  type DirecaoDoAjuste,
} from "@/lib/ajuste-de-fatura";

interface AjusteDeSaldoProps {
  /** 'outubro de 2026'. `null` quando o mes nao da para ler -- ver o item 3. */
  rotuloDoMes: string | null;
  moeda?: string;
  /** A mais pessimista das leituras da pagina. `null` = ainda carregando. */
  estado: EstadoDaLeitura | null;
  /** A categoria reservada do usuario. `undefined` = nao deu para conferir. */
  categoriaDeAjuste: CategoriaDeAjuste;
  /** O ajuste que ja esta valendo, COMO A FATURA O VE. `null` = nao ha. */
  valorAtual: number | null;
  /** O total da fatura sem ajuste nenhum. E a base da previa. */
  totalSemAjuste: number;
  /** O formulario esta aberto? Quem abre e fecha e a pagina. */
  aberto: boolean;
  /** Valor em notacao plana ("50.00"), como `CampoDeValor` emite. */
  valor: string;
  direcao: DirecaoDoAjuste;
  descricao: string;
  salvando?: boolean;
  aoAbrir: () => void;
  aoFechar: () => void;
  aoMudarValor: (valorPlano: string) => void;
  aoMudarDirecao: (direcao: DirecaoDoAjuste) => void;
  aoMudarDescricao: (descricao: string) => void;
  aoSalvar: () => void;
  aoRemover: () => void;
}

export function AjusteDeSaldo({
  rotuloDoMes,
  moeda,
  estado,
  categoriaDeAjuste,
  valorAtual,
  totalSemAjuste,
  aberto,
  valor,
  direcao,
  descricao,
  salvando,
  aoAbrir,
  aoFechar,
  aoMudarValor,
  aoMudarDirecao,
  aoMudarDescricao,
  aoSalvar,
  aoRemover,
}: AjusteDeSaldoProps) {
  const mostraNumero = podeMostrarNumero(estado);
  const podeConferir = podeConferirAjuste(categoriaDeAjuste);

  // A previa so existe com valor valido: `validarAjuste` e a MESMA funcao que a
  // rota chama, de proposito. Uma conta propria aqui discordaria do que o POST
  // grava no caso que ninguem testa -- e a previa e a unica coisa que o usuario
  // le antes de confirmar.
  const validado = validarAjuste({ valor, direcao });
  const previa = validado.ok
    ? totalComOAjuste(totalSemAjuste, validado.valorNaFatura)
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4 text-muted-foreground" />
              Ajuste de saldo
            </CardTitle>
            <CardDescription>
              Para a fatura fechar igual à do banco sem detalhar o que foi o
              gasto.
            </CardDescription>
          </div>

          {/* ----------------------------------------------------------------
              O ESTADO ATUAL. Tres situacoes, e nenhuma pode ser confundida
              com outra: nao deu para conferir, nao ha ajuste, ha ajuste.
              ---------------------------------------------------------------- */}
          {!podeConferir ? (
            <Badge variant="outline" className="border-warning/30 text-warning">
              Não foi possível conferir
            </Badge>
          ) : valorAtual !== null ? (
            <Badge variant="outline" className="border-info/30 text-info">
              {mostraNumero ? (
                <>
                  {valorAtual >= 0 ? "+" : "−"}
                  {formatarValor(Math.abs(valorAtual), moeda)} nesta fatura
                </>
              ) : (
                <NumeroIndisponivel />
              )}
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* O bloco NAO afirma "esta fatura nao tem ajuste" quando nao deu para
            conferir, e tambem nao oferece gravar: um POST daqui reescreveria um
            ajuste que a tela nao sabe que existe. */}
        {!podeConferir ? (
          <p className="text-sm text-muted-foreground">
            Não foi possível conferir se esta fatura tem ajuste de saldo agora.
            Recarregue antes de lançar um, para não trocar um ajuste sem querer.
          </p>
        ) : !aberto ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={aoAbrir}>
              {valorAtual !== null ? "Alterar ajuste" : "Ajustar saldo"}
            </Button>
            {valorAtual !== null && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={aoRemover}
                disabled={salvando}
              >
                Remover ajuste
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* --------------------------------------------------------------
                O LADO DO AJUSTE. Dois botoes, e o escolhido fica marcado com
                `aria-pressed` -- sem isso o unico sinal de qual lado esta
                valendo seria a cor, e cor nao chega em leitor de tela.
                -------------------------------------------------------------- */}
            <div className="space-y-2">
              <Label className="text-xs">O ajuste</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={direcao === "aumenta" ? "default" : "outline"}
                  aria-pressed={direcao === "aumenta"}
                  onClick={() => aoMudarDirecao("aumenta")}
                >
                  Aumenta a fatura
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={direcao === "abate" ? "default" : "outline"}
                  aria-pressed={direcao === "abate"}
                  onClick={() => aoMudarDirecao("abate")}
                >
                  Abate da fatura
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="valor-do-ajuste" className="text-xs">
                  Valor do ajuste
                </Label>
                {/* O campo de dinheiro deste app: MOSTRA "R$ 50,00" e EMITE
                    "50.00". Um `<input type="number">` aqui gravaria 1 real
                    quando alguem digitasse "1.000,00" (ver lib/dinheiro.ts). */}
                <CampoDeValor
                  id="valor-do-ajuste"
                  value={valor}
                  onChange={aoMudarValor}
                  moeda={moeda}
                  placeholder="R$ 0,00"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="descricao-do-ajuste" className="text-xs">
                  Descrição (opcional)
                </Label>
                <Input
                  id="descricao-do-ajuste"
                  value={descricao}
                  onChange={(evento) => aoMudarDescricao(evento.target.value)}
                  placeholder="IOF, anuidade, compra não lançada…"
                  maxLength={120}
                />
              </div>
            </div>

            {/* --------------------------------------------------------------
                A PREVIA, COM O MES NO ROTULO. "Passa de X para Y" sozinho nao
                diz de que fatura ele fala, e o seletor de mes fica dois blocos
                acima -- o numero certo respondendo uma pergunta que o leitor
                nao sabe qual e.

                Ela tambem exige `mostraNumero`: a base da conta e o total da
                fatura, e uma previa calculada sobre uma fatura que a tela nao
                conseguiu ler e um numero inventado com cara de numero certo.
                -------------------------------------------------------------- */}
            {validado.ok && previa !== null && mostraNumero && rotuloDoMes ? (
              <p className="text-sm text-muted-foreground">
                A fatura de {rotuloDoMes} passa de{" "}
                <span className="font-medium text-foreground">
                  {formatarValor(totalSemAjuste, moeda)}
                </span>{" "}
                para{" "}
                <span className="font-semibold text-foreground">
                  {formatarValor(previa, moeda)}
                </span>
                .
              </p>
            ) : null}

            {/* O erro de validacao sai da MESMA funcao que a rota usa: o que a
                tela recusa e o que o servidor recusaria, com o mesmo texto. */}
            {!validado.ok && valor.trim() !== "" ? (
              <p className="text-sm text-destructive">{validado.erro}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={aoSalvar} disabled={salvando}>
                {salvando ? "Salvando…" : "Salvar ajuste"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={aoFechar}
                disabled={salvando}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
