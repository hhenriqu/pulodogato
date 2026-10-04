"use client";

// ---------------------------------------------------------------------------
// OS GASTOS DE UM CARTAO (HMO-210)  /dashboard/cartoes/[id]
// ---------------------------------------------------------------------------
// Fase 3 da HMO-208. A Fase 2 (HMO-209) tirou a compra individual de cartao de
// Contas a Pagar, para a mesma despesa nao ser somada duas vezes ao lado da
// fatura cheia. Esta tela e o lugar onde aquelas compras voltam a aparecer --
// agora dentro da fatura a que elas pertencem, e com o mes no rotulo.
//
// SO A FIACAO ESTA AQUI. A marcacao esta em `components/cartoes/FaturaDoCartao`
// e as regras em `lib/fatura-do-cartao.ts`, porque e isso que o teste consegue
// renderizar e afirmar sem navegador.
//
// NAO HA ROTA NOVA, de proposito. `GET /api/card-invoices` ja aceita
// `account_id` e decide o mes da compra pela view `card_invoice_lines` (006).
// Uma segunda consulta aquela view seria uma segunda chance de divergir da
// primeira -- e a divergencia apareceria como "o painel diz R$ 1.200 e o
// cartao diz R$ 1.340", sem nada ficar vermelho.
//
// DUAS LEITURAS, UM ESTADO
// ------------------------
// O cabecalho (nome, limite, fechamento/vencimento) vem do CADASTRO, e a lista
// vem da FATURA: duas chamadas. `estadoDaTela` reduz as duas a mais pessimista
// antes de qualquer numero aparecer, senao o cadastro fresco libera o total de
// uma fatura que nao carregou -- "R$ 0,00" indistinguivel de um mes sem compra.
//
// NAO ha `useSearchParams` nesta rota. Sob `[id]` o Next consome a chave de
// mesmo nome ao montar `params`, e `searchParams.get("id")` volta `null`
// (HMO-142). O cartao escolhido viaja para o formulario de despesa por
// `PARAM_DO_CARTAO`, que vale `cartao`.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CardInvoice } from "@/types/financial";
import { useContas } from "@/lib/hooks/useContas";
import { buscarLeitura, type EstadoDaLeitura } from "@/lib/offline-leitura";
import {
  cartaoDaTela,
  estadoDaTela,
  faturaDoCartao,
  mesCorrenteDaFatura,
} from "@/lib/fatura-do-cartao";
import {
  FaixaDadoDoAparelho,
  PainelErroDoServidor,
  PainelSemRede,
} from "@/components/SemRede";
import { FaturaDoCartao } from "@/components/cartoes/FaturaDoCartao";
import { AjusteDeSaldo } from "@/components/cartoes/AjusteDeSaldo";
import { DialogoDeAlcance } from "@/components/series/DialogoDeAlcance";
import { frasePreservadas, type Alcance } from "@/lib/alcance-na-tela";
import {
  ajusteDaFatura,
  totalSemOAjuste,
  valorDoAjusteNaFatura,
  type CategoriaDeAjuste,
} from "@/lib/ajuste-de-fatura";
import { rotuloDaFatura } from "@/lib/fatura-do-cartao";
import { formatarValor } from "@/lib/dinheiro";
import { toast } from "sonner";

interface RespostaDeFaturas {
  month?: string;
  invoices?: CardInvoice[];
  /**
   * A categoria reservada do ajuste de saldo (HMO-253).
   *
   * AUSENTE e diferente de `null`: ausente e "a consulta da categoria falhou" e
   * `null` e "este usuario nunca ajustou fatura nenhuma". Por isso o estado
   * desta pagina guarda `CategoriaDeAjuste` (que inclui `undefined`) e nao
   * `string | null` -- sem a distincao, a tela ofereceria "Ajustar saldo" sobre
   * uma fatura que ja tem ajuste e o usuario trocaria um ajuste sem saber.
   */
  adjustment_category_id?: string | null;
}

/** O que o dialogo precisa saber da linha clicada. */
type LinhaParaApagar = {
  transaction_id: string;
  installment_number?: number | null;
  installment_total?: number | null;
};

export default function GastosDoCartaoPage() {
  const params = useParams<{ id: string }>();
  const idDoCartao = typeof params?.id === "string" ? params.id : "";

  // O cadastro. `include_inactive=1` ja vem de dentro do hook, entao abrir o
  // link de um cartao arquivado mostra a fatura dele em vez de "nao e seu".
  const {
    ativas,
    arquivadas,
    carregando: carregandoContas,
    estado: estadoDasContas,
    guardadoEm,
    carregar: recarregarContas,
  } = useContas("cartao");

  const [mes, setMes] = useState(() => mesCorrenteDaFatura());
  const [faturas, setFaturas] = useState<CardInvoice[] | null>(null);
  const [estadoDaFatura, setEstadoDaFatura] = useState<EstadoDaLeitura | null>(
    null
  );
  /** A parcela cuja exclusao espera a pergunta do alcance (HMO-228). */
  const [parcelaParaApagar, setParcelaParaApagar] =
    useState<LinhaParaApagar | null>(null);
  const [apagando, setApagando] = useState(false);

  // ---------------------------------------------------------------------
  // O AJUSTE DE SALDO (HMO-253)
  // ---------------------------------------------------------------------
  // Nasce `undefined`, e nao `null`: antes da primeira resposta a tela nao sabe
  // se esta fatura tem ajuste, e `null` ali afirmaria que nao tem.
  const [categoriaDeAjuste, setCategoriaDeAjuste] =
    useState<CategoriaDeAjuste>(undefined);
  const [ajusteAberto, setAjusteAberto] = useState(false);
  /**
   * QUANTO O CARTAO DIZ HOJE, em notacao plana ("1290.00"), como `CampoDeValor`
   * emite. Nao e o valor do ajuste: a diferenca e derivada no servidor.
   */
  const [saldoRealDoCartao, setSaldoRealDoCartao] = useState("");
  const [descricaoDoAjuste, setDescricaoDoAjuste] = useState("");
  const [salvandoAjuste, setSalvandoAjuste] = useState(false);

  const conta = useMemo(
    () => cartaoDaTela([...ativas, ...arquivadas], idDoCartao),
    [ativas, arquivadas, idDoCartao]
  );

  const carregarFatura = useCallback(async () => {
    if (!idDoCartao) return;

    setEstadoDaFatura(null);
    const leitura = await buscarLeitura<RespostaDeFaturas>(
      `/api/card-invoices?account_id=${encodeURIComponent(
        idDoCartao
      )}&month=${mes}`
    );

    setEstadoDaFatura(leitura.estado);
    // So sobrescreve quando houve corpo: zerar no caminho de falha apagaria da
    // tela a fatura que uma busca anterior ja tinha trazido, e a lista sumiria
    // ao perder o sinal -- mesma regra do `useContas`.
    if (leitura.dados) {
      setFaturas(leitura.dados.invoices ?? []);
      // SEM `?? null` aqui, de proposito: o campo vem AUSENTE quando a consulta
      // da categoria reservada falhou, e `undefined` e o que diz "nao da para
      // conferir". Trocar por `null` transformaria a falha em "nao tem ajuste",
      // que e a afirmacao que a tela nao pode fazer.
      setCategoriaDeAjuste(leitura.dados.adjustment_category_id);
    }
  }, [idDoCartao, mes]);

  useEffect(() => {
    carregarFatura();
  }, [carregarFatura]);

  const estado = estadoDaTela([estadoDasContas, estadoDaFatura]);

  const recarregar = useCallback(() => {
    recarregarContas();
    carregarFatura();
  }, [recarregarContas, carregarFatura]);

  /**
   * Apagar uma parcela desta fatura, no alcance escolhido (HMO-228).
   *
   * A fiacao mora aqui porque `FaturaDoCartao` nao tem rede: ele so chama o
   * handler. Ver o cabecalho dele.
   */
  const apagarParcela = async (alcance: Alcance) => {
    const parcela = parcelaParaApagar;
    if (!parcela) return;

    setApagando(true);
    try {
      const resposta = await fetch(
        `/api/financial-installments/serie/${parcela.transaction_id}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          // O alcance no CORPO: um laco de ids aqui ficaria aplicado pela
          // metade quando a conexao cai, e meia serie apagada nao tem como ser
          // descoberta depois.
          body: JSON.stringify({ alcance }),
        }
      );
      const dados = await resposta.json().catch(() => ({}));

      if (!resposta.ok) {
        toast.error(
          dados.error || `A exclusão foi recusada (HTTP ${resposta.status}).`
        );
        return;
      }

      const aviso = frasePreservadas({
        preservadas: Number(dados.preservadas ?? 0),
        porFaturaPaga: Number(dados.preservadas_por_fatura_paga ?? 0),
      });
      toast.success(
        aviso ? `${dados.message} ${aviso}` : (dados.message ?? "Parcela apagada")
      );

      setParcelaParaApagar(null);
      // A fatura DESTE mes e as dos outros mudaram: `todas` apaga parcelas de
      // meses que nao estao na tela. Recarregar so a atual deixaria o total dos
      // outros meses errado na memoria ate a pessoa trocar o seletor.
      recarregar();
    } catch (erro) {
      console.error("Erro ao apagar a série de parcelas:", erro);
      toast.error("Erro ao apagar a parcela");
    } finally {
      setApagando(false);
    }
  };

  // -----------------------------------------------------------------------
  // O AJUSTE DE SALDO: A FIACAO (HMO-253)
  // -----------------------------------------------------------------------
  // Mora aqui porque `AjusteDeSaldo` nao tem rede -- ele so chama handlers. Ver
  // o cabecalho dele.
  const fatura = faturaDoCartao(faturas, idDoCartao);
  const ajuste = ajusteDaFatura(fatura, idDoCartao, categoriaDeAjuste);

  /**
   * Abre o formulario com o campo de saldo real VAZIO.
   *
   * Preencher com o total da fatura (que seria o "estado atual" por analogia com
   * a versao anterior desta tela) seria um default que colapsa a feature: o
   * campo ja viria com o numero que faz a diferenca ser zero, e quem clicasse
   * Salvar sem digitar REMOVERIA o ajuste que estava valendo. O campo e o unico
   * dado que so o usuario tem -- ele nasce vazio.
   *
   * A DESCRICAO, sim, reabre com a que esta gravada: ela e texto do usuario e
   * perde-la a cada alteracao obrigaria a redigitar o motivo do ajuste.
   */
  const abrirAjuste = () => {
    setSaldoRealDoCartao("");
    setDescricaoDoAjuste(ajuste ? ajuste.description : "");
    setAjusteAberto(true);
  };

  const salvarAjuste = async () => {
    setSalvandoAjuste(true);
    try {
      const resposta = await fetch("/api/card-invoices/ajuste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: idDoCartao,
          // O MES DO SELETOR, e nao o mes corrente: quem esta olhando a fatura
          // de setembro e ajustando setembro. Um default de "hoje" aqui gravaria
          // o ajuste na fatura de outro mes, com o valor certo -- as duas
          // faturas ficariam plausiveis e ninguem acharia o erro.
          month: mes,
          // O UNICO DADO QUE A TELA MANDA: quanto o cartao diz hoje. A diferenca
          // e a direcao sao calculadas no servidor, sobre o total lido na hora --
          // mandar a diferenca daqui a calcularia sobre o total que esta na tela,
          // que pode ter ficado velho (ver o cabecalho da rota).
          saldo_real: saldoRealDoCartao,
          descricao: descricaoDoAjuste,
        }),
      });
      const dados = await resposta.json().catch(() => ({}));

      if (!resposta.ok) {
        toast.error(
          dados.error || `O ajuste foi recusado (HTTP ${resposta.status}).`
        );
        return;
      }

      // TRES DESFECHOS, TRES FRASES. A rota distingue "lancou a diferenca",
      // "a fatura ja batia e o ajuste saiu" e "a fatura ja batia e nao havia
      // ajuste"; um unico "Ajuste gravado" diria que gravou dinheiro nos dois
      // casos em que ela nao gravou nada -- inclusive no que ela APAGOU uma
      // linha. O numero da fatura vai no texto porque e ele que o usuario
      // acabou de informar e quer ver confirmado.
      if (dados.fecha) {
        toast.success(
          dados.removido
            ? "A fatura já fecha nesse valor — o ajuste anterior foi removido"
            : "A fatura já fecha nesse valor — nada a ajustar"
        );
      } else {
        const diferenca = Number(dados.valor_na_fatura);
        toast.success(
          Number.isFinite(diferenca)
            ? `Ajuste de ${formatarValor(Math.abs(diferenca), conta?.currency)} ${
                diferenca > 0 ? "acrescentado à" : "abatido da"
              } fatura`
            : "Ajuste de saldo gravado"
        );
      }
      setAjusteAberto(false);
      // Recarrega a fatura INTEIRA em vez de remendar o total na memoria: o
      // total vem da view, e um remendo aqui seria uma segunda conta do mesmo
      // numero -- a que a tela mostra e a que o banco responde, divergindo no
      // primeiro arredondamento.
      recarregar();
    } catch (erro) {
      console.error("Erro ao gravar o ajuste de saldo:", erro);
      toast.error("Erro ao gravar o ajuste de saldo");
    } finally {
      setSalvandoAjuste(false);
    }
  };

  const removerAjuste = async () => {
    setSalvandoAjuste(true);
    try {
      const resposta = await fetch(
        `/api/card-invoices/ajuste?account_id=${encodeURIComponent(
          idDoCartao
        )}&month=${mes}`,
        { method: "DELETE" }
      );
      const dados = await resposta.json().catch(() => ({}));

      if (!resposta.ok) {
        toast.error(
          dados.error || `A remoção foi recusada (HTTP ${resposta.status}).`
        );
        return;
      }

      toast.success("Ajuste de saldo removido");
      setAjusteAberto(false);
      recarregar();
    } catch (erro) {
      console.error("Erro ao remover o ajuste de saldo:", erro);
      toast.error("Erro ao remover o ajuste de saldo");
    } finally {
      setSalvandoAjuste(false);
    }
  };

  if (carregandoContas || estadoDaFatura === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-info" />
      </div>
    );
  }

  // Sem cadastro nao ha cabecalho, e sem cabecalho a lista de gastos nao tem
  // dono. Os dois motivos de `conta` ser nula terminam aqui de proposito:
  // "nao e seu" e "nao existe" merecem a mesma tela, porque distinguir os dois
  // contaria a um estranho que aquele id existe.
  if (!conta) {
    if (estado === "sem-rede") {
      return <PainelSemRede oQue="este cartão" aoTentarDeNovo={recarregar} />;
    }
    if (estado === "erro-do-servidor") {
      return (
        <PainelErroDoServidor oQue="este cartão" aoTentarDeNovo={recarregar} />
      );
    }

    return (
      <Card>
        <CardContent className="space-y-4 py-10 text-center">
          <p className="font-medium text-foreground">Cartão não encontrado</p>
          <p className="text-sm text-muted-foreground">
            Ele pode ter sido removido, ou o endereço não é de um cartão seu.
          </p>
          <Button variant="outline" asChild>
            <Link href="/dashboard/cartoes">Voltar para Cartões</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {estado === "do-aparelho" && (
        <FaixaDadoDoAparelho
          guardadoEm={guardadoEm}
          soLeitura
          aoTentarDeNovo={recarregar}
        />
      )}

      <FaturaDoCartao
        conta={conta}
        fatura={fatura}
        mes={mes}
        estado={estado}
        aoMudarMes={setMes}
        aoApagarParcela={setParcelaParaApagar}
        categoriaDeAjuste={categoriaDeAjuste}
        blocoDeAjuste={
          <AjusteDeSaldo
            rotuloDoMes={rotuloDaFatura(mes)}
            moeda={conta.currency}
            estado={estado}
            categoriaDeAjuste={categoriaDeAjuste}
            valorAtual={ajuste ? valorDoAjusteNaFatura(ajuste) : null}
            // A base da conta e o total SEM ajuste nenhum. Passar `fatura.total`
            // (que ja inclui o ajuste atual) faria a diferenca ser calculada em
            // cima do ajuste velho, e a previa discordaria do que o POST grava --
            // a conta mostrada antes de confirmar errando justamente no caso em
            // que o usuario esta ALTERANDO um ajuste.
            //
            // `null` QUANDO NAO HA FATURA LIDA, e nao `totalSemOAjuste(...)`:
            // sem a fatura aquela funcao devolve 0, e uma base 0 faria a previa
            // anunciar "a fatura passa de R$ 0,00 para R$ 1.290,00" -- a tela
            // prometendo lancar como ajuste a fatura INTEIRA. Ver a armadilha 3
            // de `ajusteParaFecharEm`.
            totalSemAjuste={fatura ? totalSemOAjuste(fatura, ajuste) : null}
            aberto={ajusteAberto}
            saldoReal={saldoRealDoCartao}
            descricao={descricaoDoAjuste}
            salvando={salvandoAjuste}
            aoAbrir={abrirAjuste}
            aoFechar={() => setAjusteAberto(false)}
            aoMudarSaldoReal={setSaldoRealDoCartao}
            aoMudarDescricao={setDescricaoDoAjuste}
            aoSalvar={salvarAjuste}
            aoRemover={removerAjuste}
          />
        }
      />

      {/* A PERGUNTA DO ALCANCE, A TERCEIRA TELA (HMO-228). O mesmo componente
          de Contas a Pagar e da lista de Lancamentos. */}
      {parcelaParaApagar && (
        <DialogoDeAlcance
          aberto
          aoFechar={() => setParcelaParaApagar(null)}
          tipo="parcela"
          acao="apagar"
          ancora={`parcela ${parcelaParaApagar.installment_number}`}
          totalDeParcelas={parcelaParaApagar.installment_total}
          salvando={apagando}
          aoConfirmar={(escolhido) => apagarParcela(escolhido)}
        />
      )}
    </div>
  );
}
