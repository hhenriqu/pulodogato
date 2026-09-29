"use client";

// ---------------------------------------------------------------------------
// A CALCULADORA DO CAMPO DE VALOR (HMO-171)
// ---------------------------------------------------------------------------
// "Todos os campos de valor ao lado do input deve ter uma calculadora que abre
// como um modal permitindo o usuario calcular o valor que ele quer adicionar ao
// campo."
//
// Este arquivo e so a interface. A conta mora em lib/calculadora-de-campo.ts, e
// a divisao nao e estetica: `calcular` e a MESMA chamada que pinta a previa e
// que produz o valor aplicado. Nao existe um caminho "rapido" para a previa --
// dois caminhos para o mesmo numero e como um deles passa a mostrar outra coisa
// sem ninguem notar, e aqui isso significaria a tela prometer um valor e o campo
// receber outro.
//
// O QUE A PESSOA VE E O QUE ELA VAI RECEBER
// -----------------------------------------
// A previa mostra o resultado JA ARREDONDADO para as casas da moeda, porque e
// esse o numero que vai para o campo. Mostrar `numero` cru faria "100/3" exibir
// 33,333333 e aplicar 33,33: a diferenca apareceria depois, no extrato, sem nada
// que a explicasse.
//
// POR QUE O BOTAO FICA DESABILITADO EM VEZ DE APLICAR O QUE DEU
// ------------------------------------------------------------
// Toda recusa de `calcular` tem uma consequencia de dinheiro (ver o cabecalho de
// lib/calculadora-de-campo.ts: resultado negativo vira receita numa tela de
// despesa, Infinity chega no Postgres, 16 digitos exibem outro numero). O modal
// escreve o motivo e nao deixa aplicar. A alternativa -- aplicar o mais proximo
// possivel -- e exatamente o erro silencioso que esta issue existe para fechar.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Calculator, Delete } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MOEDA_PADRAO, formatarValor, moedaPorCodigo } from "@/lib/dinheiro";
import { calcular } from "@/lib/calculadora-de-campo";
import { cn } from "@/lib/utils";

interface CalculadoraDeValorProps {
  /**
   * O valor plano que esta no campo agora ("1000.00"), ou vazio. Serve de ponto
   * de partida da expressao.
   */
  valorAtual: string;
  /** Codigo ISO da moeda do campo. Decide simbolo e casas. */
  moeda?: string;
  /** Recebe o valor plano pronto para o estado do formulario. */
  aoAplicar: (valorPlano: string) => void;
  /** Para o leitor de tela dizer de qual campo e esta calculadora. */
  rotuloDoCampo?: string;
  disabled?: boolean;
}

/**
 * O valor do campo virado expressao editavel.
 *
 * `valorAtual` vem com PONTO decimal ("1000.50"), e ponto aqui e separador de
 * MILHAR -- semear a expressao com o texto cru faria a calculadora abrir
 * recusando o proprio valor do campo, com a mensagem de milhar ambiguo. A troca
 * por virgula e o que deixa "tenho 1000,50 no campo, quero somar 50" funcionar.
 */
function semearExpressao(valorAtual: string): string {
  if (!valorAtual) return "";
  return valorAtual.replace(".", ",");
}

/** As teclas, na ordem em que aparecem. */
const TECLAS: { rotulo: string; insere: string; aria?: string }[] = [
  { rotulo: "7", insere: "7" },
  { rotulo: "8", insere: "8" },
  { rotulo: "9", insere: "9" },
  { rotulo: "÷", insere: "/", aria: "dividir" },
  { rotulo: "4", insere: "4" },
  { rotulo: "5", insere: "5" },
  { rotulo: "6", insere: "6" },
  { rotulo: "×", insere: "*", aria: "multiplicar" },
  { rotulo: "1", insere: "1" },
  { rotulo: "2", insere: "2" },
  { rotulo: "3", insere: "3" },
  { rotulo: "−", insere: "-", aria: "subtrair" },
  { rotulo: "0", insere: "0" },
  { rotulo: ",", insere: ",", aria: "virgula" },
  { rotulo: "( )", insere: "", aria: "parenteses" },
  { rotulo: "+", insere: "+", aria: "somar" },
];

export function CalculadoraDeValor({
  valorAtual,
  moeda = MOEDA_PADRAO,
  aoAplicar,
  rotuloDoCampo,
  disabled,
}: CalculadoraDeValorProps) {
  const [aberta, setAberta] = useState(false);
  const [expressao, setExpressao] = useState("");

  const casas = moedaPorCodigo(moeda).casas;

  // Semeia a cada ABERTURA, e nao a cada mudanca do valor: sincronizar com a
  // prop apagaria a conta em andamento toda vez que o formulario mexesse no
  // campo por fora (a tela de despesa preenche o valor total a partir da
  // parcela, e a edicao carrega o lancamento do banco).
  useEffect(() => {
    if (aberta) setExpressao(semearExpressao(valorAtual));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta]);

  const resultado = calcular(expressao, { casas });

  function inserir(texto: string) {
    setExpressao((atual) => atual + texto);
  }

  /**
   * Fecha o parentese se houver algum aberto; abre um se nao houver. Uma tecla
   * so, porque no celular o teclado ja tem 16 alvos e dois deles seriam quase
   * sempre o mesmo.
   */
  function parenteses() {
    setExpressao((atual) => {
      const abertos =
        atual.split("(").length - atual.split(")").length;
      return atual + (abertos > 0 ? ")" : "(");
    });
  }

  function apagarUm() {
    setExpressao((atual) => atual.slice(0, -1));
  }

  function aplicar() {
    if (!resultado.ok) return;
    aoAplicar(resultado.valor);
    setAberta(false);
  }

  return (
    <>
      <Button
        // `button` explicito: varios destes campos vivem dentro de um <form>, e
        // um botao sem `type` e `submit` por padrao -- abrir a calculadora
        // enviaria o formulario.
        type="button"
        variant="outline"
        size="icon"
        // Alinha com a altura do Input padrao (h-10) e nao cresce: em Fluxo de
        // Caixa o campo e um `h-8 w-32` dentro de uma linha apertada.
        className="h-10 w-10 shrink-0"
        disabled={disabled}
        onClick={() => setAberta(true)}
        aria-label={
          rotuloDoCampo
            ? `Abrir calculadora para ${rotuloDoCampo}`
            : "Abrir calculadora"
        }
      >
        <Calculator className="h-4 w-4" />
      </Button>

      <Dialog open={aberta} onOpenChange={setAberta}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Calculadora</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              // Texto livre, e nao somente as teclas: quem esta no computador
              // digita a conta mais rapido do que clica nela. O `inputMode`
              // mantem o teclado numerico no celular, que e onde este app roda
              // instalado.
              type="text"
              inputMode="text"
              autoComplete="off"
              autoFocus
              value={expressao}
              onChange={(e) => setExpressao(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  // Sem isto o Enter dentro do modal submete o formulario que
                  // esta ATRAS dele -- gravando o lancamento com o valor antigo.
                  e.preventDefault();
                  aplicar();
                }
              }}
              placeholder="Ex.: 1.200,50 + 300"
              aria-label="Conta"
              className="text-right font-mono"
            />

            {/* A previa. Ocupa altura fixa para o teclado nao pular de lugar
                entre "sem resultado" e "resultado", que e o tipo de salto que
                faz o dedo acertar a tecla errada no celular. */}
            <div
              className="flex min-h-[2.5rem] items-center justify-end rounded-md bg-muted px-3 py-2"
              aria-live="polite"
            >
              {resultado.ok ? (
                <span className="text-lg font-semibold tabular-nums text-foreground">
                  {formatarValor(resultado.numero, moeda)}
                </span>
              ) : (
                <span
                  className={cn(
                    "text-left text-xs",
                    // "Digite uma conta" e o estado inicial, nao um erro: em
                    // destructive ele acusaria a pessoa de ter errado antes de
                    // ela digitar qualquer coisa.
                    resultado.motivo === "vazia"
                      ? "text-muted-foreground"
                      : "text-destructive"
                  )}
                >
                  {resultado.mensagem}
                </span>
              )}
            </div>

            {/* `grid-cols-4` explicito: uma trilha `auto` tem min-content como
                piso, e sem as colunas declaradas este teclado estoura a largura
                da tela no celular. */}
            <div className="grid grid-cols-4 gap-2">
              {TECLAS.map((tecla) => (
                <Button
                  key={tecla.rotulo}
                  type="button"
                  variant={/[0-9,]/.test(tecla.insere) ? "secondary" : "outline"}
                  className="h-11 text-base"
                  onClick={() =>
                    tecla.rotulo === "( )" ? parenteses() : inserir(tecla.insere)
                  }
                  aria-label={tecla.aria}
                >
                  {tecla.rotulo}
                </Button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                onClick={() => setExpressao("")}
              >
                Limpar
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={apagarUm}
                aria-label="Apagar o ultimo caractere"
              >
                <Delete className="h-4 w-4" />
              </Button>
            </div>

            <Button
              type="button"
              className="h-11 w-full"
              // A recusa e a razao do desabilitado, e o motivo ja esta escrito
              // na previa acima.
              disabled={!resultado.ok}
              onClick={aplicar}
            >
              {resultado.ok
                ? `Usar ${formatarValor(resultado.numero, moeda)}`
                : "Usar valor"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
