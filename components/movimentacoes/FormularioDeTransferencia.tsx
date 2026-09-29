"use client";

// ---------------------------------------------------------------------------
// A TELA DE TRANSFERENCIA (HMO-164)
// ---------------------------------------------------------------------------
// Ela nao reusa `FormularioDeLancamento` de proposito. Aquele container carrega
// categorias, natureza, parcelamento, rateio e a fila offline -- e nenhuma
// dessas coisas existe numa transferencia. Passar `tipo="transfer"` por ali
// significaria seis `if` novos dentro de um arquivo que acabou de sair de ter
// tres telas escondidas em uma.
//
// O que ela tem que a tela antiga nao tinha: DUAS contas. O formulario antigo
// tinha um seletor so, entao "Transferencia/Balanco" gravava uma linha e o
// dinheiro saia de uma conta sem entrar em nenhuma.
//
// O que ela nao tem: categoria. Transferencia entre contas proprias nao e
// gasto nem ganho. A categoria que o banco exige (NOT NULL) e escolhida pela
// rota, e nao aparece em seletor nenhum.
//
// A gravacao e uma ROTA, nao um insert daqui: sao duas linhas, e se a segunda
// falhar a primeira tem que ser desfeita mesmo que a pessoa feche a aba.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CampoDeValor } from "@/components/ui/campo-de-valor";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, ArrowRight, ArrowRightLeft, WifiOff } from "lucide-react";
import { useOfflineQueue } from "@/lib/hooks/useOfflineQueue";
import {
  contasDeOrigem,
  validarTransferencia,
  valoresIniciaisDeTransferencia,
  type ContaDaTransferencia,
  type ValoresDeTransferencia,
} from "@/lib/transferencia";

interface ContaNaTela extends ContaDaTransferencia {
  id: string;
  name: string;
  account_type?: string | null;
}

export function FormularioDeTransferencia() {
  const router = useRouter();
  const { online } = useOfflineQueue();

  const [contas, setContas] = useState<ContaNaTela[]>([]);
  /**
   * A lista de contas chegou do servidor nesta visita?
   *
   * Sem esta distincao, a tela sem rede mostraria "Transferência precisa de
   * duas contas cadastradas" para quem tem seis contas -- o "zero confiante"
   * que o pedagio do precache (`lib/pwa-precache.js`) proibe. Lista vazia e
   * "nao ha o que escolher"; falha de leitura e "nao sei o que voce tem", e as
   * duas dao a mesma tela sem este estado.
   */
  const [contasLidas, setContasLidas] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [valores, setValores] = useState<ValoresDeTransferencia>(
    valoresIniciaisDeTransferencia()
  );

  const aoMudar = (mudanca: Partial<ValoresDeTransferencia>) =>
    setValores((atual) => ({ ...atual, ...mudanca }));

  useEffect(() => {
    const carregar = async () => {
      try {
        const resposta = await fetch("/api/financial-accounts");
        const dados = await resposta.json();
        if (resposta.ok) {
          setContas(dados.accounts || dados || []);
          setContasLidas(true);
        }
      } catch (erro) {
        // Sem rede a tela nao tem o que fazer mesmo: a transferencia exige
        // conexao. O aviso de offline abaixo e que explica isso.
        console.error("Erro ao carregar contas:", erro);
      } finally {
        setCarregando(false);
      }
    };

    carregar();
  }, []);

  const origens = contasDeOrigem(contas);
  const destinos = contas;

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();

    const validacao = validarTransferencia(valores, contas);
    if (!validacao.ok) {
      toast.error(validacao.mensagem);
      return;
    }

    setSalvando(true);
    try {
      const resposta = await fetch("/api/movimentacoes/transferencia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descricao: valores.descricao,
          valor: Number.parseFloat(valores.valor),
          origem_id: valores.origemId,
          destino_id: valores.destinoId,
          data: valores.data,
          notas: valores.notas || null,
        }),
      });

      const dados = await resposta.json();
      if (!resposta.ok) {
        toast.error(dados.error || "Não foi possível lançar a transferência");
        return;
      }

      toast.success(dados.message || "Transferência lançada.");
      router.push("/dashboard/personal-finance");
    } catch (erro) {
      console.error("Erro ao lançar transferência:", erro);
      // Sem ramo de fila aqui, e isso e a decisao: a fila recusa transferencia
      // (ver `avaliarLancamento`), porque um reenvio que grava so uma das
      // pernas erra o saldo das duas contas pelo valor inteiro.
      toast.error(
        "Não foi possível lançar a transferência. Ela precisa de conexão."
      );
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6 max-w-3xl">
      <div className="space-y-2">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/dashboard/personal-finance">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar para os lançamentos
          </Link>
        </Button>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <ArrowRightLeft className="h-7 w-7 text-info" />
          Nova Transferência
        </h1>
        <p className="text-muted-foreground">
          Dinheiro que andou entre contas suas. Não é receita nem despesa: o
          total do mês não muda, só o saldo das duas contas.
        </p>
        {!online && (
          <p className="text-sm text-warning flex items-center gap-2">
            <WifiOff className="h-4 w-4" />
            Sem conexão. A transferência grava duas linhas e precisa de rede —
            sem ela, metade ficaria gravada e o saldo das duas contas erraria.
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dados da transferência</CardTitle>
          <CardDescription>Campos com * são obrigatórios.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={enviar} className="space-y-6">
            {/* `grid-cols-1` explicito: sem a coluna de base, o trilho `auto`
                tem o min-content como PISO e estoura o container no celular
                (HMO-168). */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="description">Descrição *</Label>
                <Input
                  id="description"
                  value={valores.descricao}
                  onChange={(e) => aoMudar({ descricao: e.target.value })}
                  placeholder="Ex: Reserva de emergência"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="amount">Valor *</Label>
                <CampoDeValor
                  id="amount"
                  value={valores.valor}
                  onChange={(valor) => aoMudar({ valor })}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Digite quanto andou, sem sinal. Sai da origem e entra no
                  destino pelo mesmo valor.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="origem">De qual conta saiu *</Label>
                <Select
                  value={valores.origemId}
                  onValueChange={(value: string) => aoMudar({ origemId: value })}
                >
                  <SelectTrigger id="origem">
                    <SelectValue placeholder="Conta de origem" />
                  </SelectTrigger>
                  <SelectContent>
                    {origens.map((conta) => (
                      <SelectItem key={conta.id} value={conta.id}>
                        {conta.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Cartao fora da origem, e a tela diz por que. Sem esta linha
                    o cartao "some" da lista e parece defeito de carregamento. */}
                <p className="text-xs text-muted-foreground">
                  Cartão de crédito não aparece aqui: ele não tem saldo de onde
                  tirar. Para quitar a fatura, use Contas Previstas.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="destino">Para qual conta foi *</Label>
                <Select
                  value={valores.destinoId}
                  onValueChange={(value: string) =>
                    aoMudar({ destinoId: value })
                  }
                >
                  <SelectTrigger id="destino">
                    <SelectValue placeholder="Conta de destino" />
                  </SelectTrigger>
                  <SelectContent>
                    {destinos
                      .filter((conta) => conta.id !== valores.origemId)
                      .map((conta) => (
                        <SelectItem key={conta.id} value={conta.id}>
                          {conta.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="date">Data *</Label>
                <Input
                  id="date"
                  type="date"
                  value={valores.data}
                  onChange={(e) => aoMudar({ data: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Observações</Label>
              <Textarea
                id="notes"
                value={valores.notas}
                onChange={(e) => aoMudar({ notas: e.target.value })}
                placeholder="Detalhes adicionais (opcional)"
                rows={2}
              />
            </div>

            {/* So afirma a falta quando a lista chegou de verdade. Sem rede a
                frase seria falsa para quem tem seis contas. */}
            {contasLidas && contas.length < 2 && (
              <p className="text-sm text-warning">
                Transferência precisa de duas contas cadastradas. Cadastre em
                Contas antes de lançar.
              </p>
            )}
            {!contasLidas && (
              <p className="text-sm text-warning">
                Não consegui carregar suas contas. Sem elas não dá para escolher
                origem e destino — tente de novo com conexão.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={salvando || !online}>
                <ArrowRight className="h-4 w-4 mr-1" />
                {salvando ? "Lançando..." : "Lançar transferência"}
              </Button>
              <Button variant="outline" asChild>
                <Link href="/dashboard/personal-finance">Cancelar</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
