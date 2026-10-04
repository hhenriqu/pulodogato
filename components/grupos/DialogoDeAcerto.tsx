"use client";

// ---------------------------------------------------------------------------
// O DIALOGO DO ACERTO: ONDE A CONTA E ESCOLHIDA (HMO-245, fase 11)
// ---------------------------------------------------------------------------
// Antes desta fase, registrar um acerto era um BOTAO DE UM CLIQUE sobre a
// transferencia sugerida: payload pronto, nenhum campo. Ele gravava a quitacao
// e nada mais -- o Pix nao aparecia em lugar nenhum e o saldo da conta corrente
// nao se mexia.
//
// Agora a quitacao grava a perna de quem registra em `financial_transactions`,
// e uma perna precisa de CONTA. Esse e o unico dado novo, e ele nao tem padrao
// razoavel: ninguem pode adivinhar de qual conta saiu o Pix, e escolher a
// primeira da lista poria dinheiro na conta errada sem ninguem pedir. Por isso
// virou dialogo, e por isso o campo e obrigatorio nos dois lados (a rota recusa
// um POST sem `account_id`).
//
// POR QUE A ESCOLHA DE MOEDA CONTINUA NOS BOTOES, E NAO AQUI DENTRO
// -----------------------------------------------------------------
// A tela do grupo oferece "Paguei em reais" e "Paguei em USD" quando ha cotacao
// de hoje -- sao dois acertos diferentes (valores diferentes, sobra diferente),
// e a diferenca ja esta explicada no botao e no title dele. Os dois abrem ESTE
// dialogo com o acerto ja montado por `acertoNaMoedaDaViagem`; aqui so se
// escolhe a conta e se confirma. Mover a moeda para dentro trocaria uma escolha
// explicada por um seletor a mais no mesmo passo.
//
// O QUE ESTE COMPONENTE NAO FAZ
// -----------------------------
// Rede. Ele devolve a conta escolhida por `aoConfirmar(contaId)`. A regra de
// quais contas servem, a conversao para a moeda da conta e as frases moram em
// `lib/acerto-em-lancamento.ts`, puro -- a MESMA funcao que o servidor usa para
// montar a perna. Se a lista da tela e a regra da rota divergirem, a tela
// oferece uma opcao que o POST recusa; com uma funcao so, nao da.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatarValor } from "@/lib/dinheiro";
import {
  contasParaOAcerto,
  fraseDoLancamentoDoAcerto,
  mensagemDaContaDoAcerto,
  pernaDoAcerto,
  type ContaDoAcerto,
  type DirecaoDoAcerto,
} from "@/lib/acerto-em-lancamento";

/** O que o dialogo precisa saber de cada conta. `name` e o que a pessoa le. */
export interface ContaParaEscolher extends ContaDoAcerto {
  name: string;
}

export interface DialogoDeAcertoProps {
  aberto: boolean;
  aoFechar: () => void;
  /** Quem registra esta recebendo ou pagando? Define o sinal e o texto. */
  direcao: DirecaoDoAcerto;
  /** O nome de quem esta do outro lado do Pix. */
  nomeDaContraparte?: string | null;
  /** O valor na moeda do PAGAMENTO, como vai para `group_settlements.amount`. */
  valor: number;
  moeda: string;
  /** A cotacao que a quitacao vai gravar (1 em real). */
  cotacao: number;
  contas: ContaParaEscolher[];
  /** Aviso de sobra de centavo, quando a cotacao nao divide redondo. */
  aviso?: string | null;
  aoConfirmar: (contaId: string) => void | Promise<void>;
  salvando?: boolean;
}

export function DialogoDeAcerto({
  aberto,
  aoFechar,
  direcao,
  nomeDaContraparte,
  valor,
  moeda,
  cotacao,
  contas,
  aviso,
  aoConfirmar,
  salvando = false,
}: DialogoDeAcertoProps) {
  // Nasce VAZIO, sempre. Um padrao aqui seria a conta errada escolhida por
  // omissao -- e o erro nao apareceria na tela do grupo, so no extrato de uma
  // conta que a pessoa nao estava olhando.
  const [contaId, setContaId] = useState("");

  const elegiveis = useMemo(
    () => contasParaOAcerto(contas || [], moeda),
    [contas, moeda]
  );

  const contaEscolhida = elegiveis.find((c) => c.id === contaId) || null;

  // A MESMA funcao do servidor, com um id de mentira: aqui ela serve para dizer
  // quanto e em que moeda a perna vai entrar DEPOIS de a conta ser escolhida --
  // uma divida de R$ 267,50 paga de uma conta em dolar entra em dolar.
  const previsao = contaEscolhida
    ? pernaDoAcerto({
        direcao,
        conta: contaEscolhida,
        amount: valor,
        currency: moeda,
        exchange_rate: cotacao,
        settledOn: "2000-01-01",
        settlementId: "00000000-0000-0000-0000-000000000000",
      })
    : null;

  const quem = (nomeDaContraparte || "").trim();
  const titulo = direcao === "recebi" ? "Registrar o que recebi" : "Registrar o que paguei";
  const resumo =
    direcao === "recebi"
      ? `${quem || "A outra pessoa"} te pagou ${formatarValor(valor, moeda)}.`
      : `Você pagou ${formatarValor(valor, moeda)}${quem ? ` para ${quem}` : ""}.`;

  const fechar = () => {
    setContaId("");
    aoFechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => (v ? null : fechar())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            {resumo} Escolha a conta por onde o dinheiro passou: o acerto vira um
            lançamento nela.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="conta-do-acerto">
              {direcao === "recebi" ? "Entrou na conta" : "Saiu da conta"}
            </Label>
            {elegiveis.length > 0 ? (
              <Select value={contaId} onValueChange={setContaId}>
                <SelectTrigger id="conta-do-acerto">
                  <SelectValue placeholder="Escolha a conta" />
                </SelectTrigger>
                <SelectContent>
                  {elegiveis.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              /* Cartao de credito e conta numa terceira moeda ficam fora da
                 lista (ver `contasParaOAcerto`). Quando nao sobra nenhuma, a
                 tela diz POR QUE -- um seletor vazio pareceria defeito. */
              <p className="text-sm text-destructive">
                {mensagemDaContaDoAcerto("moeda_incompativel", moeda)}
              </p>
            )}
          </div>

          {/* O que vai acontecer, em uma frase, antes de clicar. */}
          {previsao?.perna && (
            <p className="text-sm text-muted-foreground">
              {fraseDoLancamentoDoAcerto({
                direcao,
                valor: previsao.perna.amount,
                moeda: previsao.perna.currency,
                nomeDaConta: contaEscolhida?.name,
                formatar: formatarValor,
              })}
            </p>
          )}

          {previsao?.problema && (
            <p className="text-sm text-destructive">
              {mensagemDaContaDoAcerto(previsao.problema, moeda)}
            </p>
          )}

          {aviso && <p className="text-sm text-warning">{aviso}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={fechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            onClick={() => contaId && aoConfirmar(contaId)}
            // Sem conta nao ha o que confirmar: a rota recusaria com 400, e um
            // botao que leva a recusa e pior do que um botao desabilitado.
            disabled={salvando || !contaId || !previsao?.perna}
          >
            {salvando ? "Registrando..." : "Registrar acerto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
