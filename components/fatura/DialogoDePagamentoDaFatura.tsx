"use client";

// -----------------------------------------------------------------------------
// "DE QUAL CONTA O DINHEIRO DA FATURA SAIU?" -- HMO-310 (fase 13)
// -----------------------------------------------------------------------------
// O dialogo da conta pagadora, para as DUAS telas que vao pagar fatura (Contas
// a Pagar hoje, Despesas na fase 14). Ele era ~90 linhas dentro de
// `app/(dashboard)/dashboard/bills/page.tsx`; reescreve-lo na outra tela seria a
// SEGUNDA implementacao da de-duplicacao de fatura, e as duas divergiriam na
// primeira correcao.
//
// O QUE ESTE COMPONENTE NAO FAZ
// -----------------------------
// 1. NAO DECIDE. "Precisa de conta pagadora?" e "precisa de `close` antes do
//    `pay`?" sao `decisaoDePagamentoDaFatura`, e a sequencia das escritas (com o
//    409 do `close`) e `pagarAFatura` -- as duas em `lib/pagamento-da-fatura.ts`,
//    com teste em `node --test`. Aqui fica marcacao, estado de dialogo e toast.
// 2. NAO FORMATA NUMERO NEM DATA. O valor e o vencimento chegam JA formatados
//    da tela, e `hoje` chega de quem tem o fuso (`America/Sao_Paulo` na tela).
//    Um `new Date()` aqui poria o fuso do servidor de render na data do
//    pagamento.
//
//    `hoje` e uma FUNCAO e nao uma string (HMO-315), e a diferenca e dinheiro:
//    uma string e lida no render do pai, e o `paid_date` que este dialogo grava
//    e do clique em Confirmar. Numa aba de PWA aberta a noite inteira os dois
//    nao sao o mesmo dia -- e no dia 1o nem o mesmo MES, o que muda o
//    lancamento de mes no fluxo de caixa sem nada na tela acusar. O fuso
//    continua sendo da tela; o relogio e lido no gesto.
// 3. NAO ESCREVE AS FRASES. Elas vem da lib, porque as duas telas dizem a mesma
//    coisa sobre a mesma linha -- e porque `MOTIVO_SEM_CONTA_PAGADORA` e a
//    recusa que a propria rota devolve.
//
// AS CONTAS SAO BUSCADAS AO ABRIR, E ISSO E REQUISITO
// ---------------------------------------------------
// Na montagem da tela a lista envelhece: quem cadastra a conta corrente numa
// aba e volta para pagar a fatura na outra nao a encontra no seletor, e a unica
// saida visivel e recarregar a pagina. Buscar ao abrir tambem e o que permite
// este componente nao exigir nada da tela que o hospeda -- a fase 14 o usa sem
// adicionar leitura nenhuma.
//
// NENHUMA CONTA VEM PRE-SELECIONADA, E ESSA E A UNICA MUDANCA DE COMPORTAMENTO
// ---------------------------------------------------------------------------
// Contas a Pagar pre-selecionava a primeira conta pagadora. Com a busca ao
// abrir nao ha o que pre-selecionar no instante da abertura, e manter o padrao
// depois da resposta e justamente o que `validarContaPagadora` recusa em voz
// alta (lib/card-invoice.ts): "cair num padrao lancaria dinheiro saindo de uma
// conta que o usuario nao escolheu, e o saldo errado seria descoberto semanas
// depois". Quem tem duas contas correntes pagava pela primeira da lista sem ter
// escolhido. Agora o `Confirmar` fica desabilitado com o motivo ESCRITO -- a
// mesma frase que a rota devolveria.
//
// SEM `next/navigation` AQUI (mesmo requisito de `EloDaFatura`): ele nao roda no
// node, e um teste que renderizasse esta marcacao morreria no import antes da
// primeira assercao. Quem recarrega a tela depois da escrita e `aoPagar`.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AVISO_DA_FATURA_ABERTA,
  FRASE_DO_PATRIMONIO,
  FRASE_DO_PATRIMONIO_NO_DIALOGO,
  MOTIVO_SEM_CONTA_PAGADORA,
  SEM_CONTA_PAGADORA_CADASTRADA,
  contasQuePodemPagar,
  decisaoDePagamentoDaFatura,
  pagarAFatura,
  type LinhaParaPagar,
} from "@/lib/pagamento-da-fatura";
import { valorDigitado } from "@/lib/pagamento-parcial-da-fatura";

/** O que o seletor precisa de uma conta de `GET /api/financial-accounts`. */
interface ContaDoSeletor {
  id: string;
  name: string;
  account_type?: string | null;
}

/** A linha a pagar: a decisao mais o que o dialogo mostra sobre ela. */
export interface LinhaDoPagamentoDaFatura extends LinhaParaPagar {
  /** `null` na fatura ABERTA sintetizada -- ela nao existe no banco. */
  id?: string | null;
  description?: string | null;
}

export interface DialogoDePagamentoDaFaturaProps {
  /** A linha a pagar. `null` mantem o dialogo fechado. */
  linha: LinhaDoPagamentoDaFatura | null;
  /** O valor, JA formatado pela tela ("R$ 1.234,56"). */
  valorFormatado: string;
  /**
   * O total da fatura em reais, para saber se o valor digitado e parcial.
   * Sem ele o dialogo nao oferece "levar o restante" -- a rota decide o
   * restante de qualquer forma, isto so mostra a opcao.
   */
  valor?: number | null;
  /** O vencimento, JA formatado pela tela ("10/11/26"). */
  vencimentoFormatado: string;
  /**
   * Devolve hoje em 'AAAA-MM-DD'. Quem tem o fuso e a tela.
   *
   * FUNCAO e nao string, de proposito (HMO-315): e chamada no clique de
   * Confirmar, para o `paid_date` ser o dia do pagamento e nao o dia em que a
   * aba abriu. O tipo e a guarda -- passar uma data ja congelada nao compila.
   */
  hoje: () => string;
  /** Fechar o dialogo (desistir, ou depois do sucesso). */
  aoFechar: () => void;
  /** Recarregar a tela: a baixa mudou saldo e tirou a linha da agenda. */
  aoPagar: () => void | Promise<void>;
}

export function DialogoDePagamentoDaFatura({
  linha,
  valorFormatado,
  valor = null,
  vencimentoFormatado,
  hoje,
  aoFechar,
  aoPagar,
}: DialogoDePagamentoDaFaturaProps) {
  // `null` = ainda buscando. Array vazio = buscou e nao ha nenhuma conta que
  // possa pagar, que e um estado com frase propria -- os dois nao podem ser o
  // mesmo valor, senao o dialogo abre acusando "cadastre uma conta" enquanto a
  // resposta esta no ar.
  const [contas, setContas] = useState<ContaDoSeletor[] | null>(null);
  const [contaPagadora, setContaPagadora] = useState("");
  const [pagando, setPagando] = useState(false);
  // PAGAMENTO PARCIAL (comparacao com o Minhas Financas): vazio = o total.
  const [valorTexto, setValorTexto] = useState("");
  const [levarRestante, setLevarRestante] = useState(true);
  const [encargoTexto, setEncargoTexto] = useState("");

  // A CHAVE ESTAVEL DA LINHA, e nao o objeto: `linha` e uma prop e qualquer
  // render do pai dispararia a busca de novo. A fatura ABERTA nao tem `id`,
  // entao a chave cai na canonica (cartao + mes) -- a mesma ideia de
  // `chaveDeAcao` em Contas a Pagar.
  const chaveDaLinha = linha
    ? (linha.id ?? null) ??
      (linha.fatura ? `${linha.fatura.accountId}:${linha.fatura.mes}` : "sem-id")
    : null;

  useEffect(() => {
    if (!chaveDaLinha) return;

    let vivo = true;
    setContas(null);
    setContaPagadora("");
    setValorTexto("");
    setLevarRestante(true);
    setEncargoTexto("");

    void (async () => {
      try {
        const resposta = await fetch("/api/financial-accounts");
        const dados = await resposta.json();
        if (!vivo) return;
        const lista: ContaDoSeletor[] = Array.isArray(dados.accounts)
          ? dados.accounts
          : [];
        setContas(contasQuePodemPagar(lista));
      } catch (erro) {
        console.error(erro);
        if (!vivo) return;
        // Array vazio e nao `null`: `null` deixaria o dialogo girando para
        // sempre, sem nada escrito. A frase de "nenhuma conta" e imprecisa aqui
        // (a leitura falhou, as contas podem existir), e e melhor que o
        // silencio -- o toast diz o que aconteceu.
        setContas([]);
        toast.error("Não foi possível carregar suas contas");
      }
    })();

    return () => {
      vivo = false;
    };
  }, [chaveDaLinha]);

  const valorPago = valorDigitado(valorTexto);
  const valorInvalido =
    valorTexto.trim() !== "" && (valorPago === null || valorPago <= 0);
  const encargo = valorDigitado(encargoTexto);
  const encargoInvalido = encargoTexto.trim() !== "" && encargo === null;
  const ehParcial =
    valor != null && valorPago != null && valorPago > 0 && valorPago < valor;
  const restante = ehParcial ? Math.round((valor - valorPago) * 100) / 100 : 0;

  const confirmar = useCallback(async () => {
    if (!linha || !contaPagadora || valorInvalido || encargoInvalido) return;

    setPagando(true);
    try {
      const resultado = await pagarAFatura({
        linha,
        contaPagadoraId: contaPagadora,
        // `hoje()` AQUI, dentro do handler (HMO-315): esta e a linha que decide
        // em que dia -- e no dia 1o, em que MES -- a fatura paga aparece.
        pagoEm: hoje(),
        rede: (url, init) => fetch(url, init),
        valorPago,
        levarRestante: ehParcial && levarRestante,
        encargo,
      });

      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }

      // A FRASE DO PATRIMONIO VAI NO TOAST DE SUCESSO, e nao so dentro do
      // dialogo: o dialogo fecha e o que sobra na tela e um saldo que nao
      // mudou. Sem ela, quem pagou R$ 1.000 conclui que a baixa nao
      // registrou -- e paga de novo.
      toast.success(resultado.mensagem, { description: FRASE_DO_PATRIMONIO });
      aoFechar();
      await aoPagar();
    } catch (erro) {
      console.error(erro);
      toast.error("Erro ao pagar a fatura");
    } finally {
      setPagando(false);
    }
  }, [
    linha,
    contaPagadora,
    hoje,
    aoFechar,
    aoPagar,
    valorPago,
    valorInvalido,
    encargo,
    encargoInvalido,
    ehParcial,
    levarRestante,
  ]);

  const decisao = linha ? decisaoDePagamentoDaFatura(linha) : null;
  // `faturaParaFechar` e nao `!linha.gravada`: o aviso do valor congelado vale
  // exatamente para a linha que vai passar pelo `close`, e quem sabe disso e a
  // decisao -- um segundo criterio aqui poria o aviso na fatura errada.
  const ehFaturaAberta = decisao?.faturaParaFechar != null;

  return (
    <Dialog
      open={linha !== null}
      onOpenChange={(aberto) => {
        if (!aberto) aoFechar();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pagar a fatura</DialogTitle>
        </DialogHeader>

        {linha && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border p-3">
              <p className="font-medium text-foreground">{linha.description}</p>
              <p className="text-sm text-muted-foreground">
                {valorFormatado} · vence em {vencimentoFormatado}
              </p>
              {ehFaturaAberta && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {AVISO_DA_FATURA_ABERTA}
                </p>
              )}
            </div>

            {contas === null ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando suas contas…
              </p>
            ) : contas.length === 0 ? (
              <p className="text-sm text-destructive">
                {SEM_CONTA_PAGADORA_CADASTRADA}
              </p>
            ) : (
              <>
                <div>
                  <Label>De qual conta o dinheiro saiu? *</Label>
                  <Select value={contaPagadora} onValueChange={setContaPagadora}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {contas.map((conta) => (
                        <SelectItem key={conta.id} value={conta.id}>
                          {conta.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="valor-do-pagamento">
                    Quanto você pagou?
                  </Label>
                  <Input
                    id="valor-do-pagamento"
                    inputMode="decimal"
                    placeholder={`${valorFormatado} (o total)`}
                    value={valorTexto}
                    onChange={(e) => setValorTexto(e.target.value)}
                  />
                  {valorInvalido && (
                    <p className="mt-1 text-xs text-destructive">
                      Digite um valor maior que zero, como 200 ou 200,50.
                    </p>
                  )}
                </div>

                {ehParcial && (
                  <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                    <div>
                      <Label htmlFor="levar-restante">
                        Valor restante na próxima fatura
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {levarRestante
                          ? `Os ${restante.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })} que faltaram entram na fatura seguinte, e esta fecha no valor pago.`
                          : "O que faltou continua devido no cartão, sem entrar em nenhuma fatura."}
                      </p>
                    </div>
                    <Switch
                      id="levar-restante"
                      checked={levarRestante}
                      onCheckedChange={setLevarRestante}
                    />
                  </div>
                )}

                <div>
                  <Label htmlFor="encargo-do-pagamento">
                    Encargos (juros, multa, IOF)
                  </Label>
                  <Input
                    id="encargo-do-pagamento"
                    inputMode="decimal"
                    placeholder="Opcional — entra na próxima fatura"
                    value={encargoTexto}
                    onChange={(e) => setEncargoTexto(e.target.value)}
                  />
                  {encargoInvalido && (
                    <p className="mt-1 text-xs text-destructive">
                      Digite o encargo como 12 ou 12,34.
                    </p>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  {FRASE_DO_PATRIMONIO_NO_DIALOGO}
                </p>

                {/* O MOTIVO ESCRITO do botao desabilitado. Um botao cinza sem
                    explicacao se le como "o app travou"; e a frase e a MESMA que
                    a rota devolveria em 400, e nao um texto proprio. */}
                {!contaPagadora && (
                  <p className="text-xs text-destructive">
                    {MOTIVO_SEM_CONTA_PAGADORA}
                  </p>
                )}

                <Button
                  className="w-full"
                  disabled={
                    !contaPagadora || pagando || valorInvalido || encargoInvalido
                  }
                  onClick={() => void confirmar()}
                >
                  {pagando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirmar pagamento
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
