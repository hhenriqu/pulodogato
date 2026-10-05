"use client";

// -----------------------------------------------------------------------------
// O CORPO DA TELA DE MOVIMENTACAO: A LEITURA, A LISTA E AS TRES ACOES (HMO-301)
// -----------------------------------------------------------------------------
// 10/10 do plano da HMO-279. "E em ambos os modos verificar pois todos
// lancamentos devem ter botoes de editar, excluir ou confirmar pra validar que
// foi pago ou recebido."
//
// Este arquivo e a Fase 3 da HMO-280 levada um passo adiante, e o motivo e o
// MESMO que separou `CartoesDaTela.tsx` e `SecaoDaTela.tsx` de
// `TelaDeMovimentacao.tsx`: aquele container importa `next/navigation`, que NAO
// roda no node, e um teste que o montasse morreria no import antes da primeira
// assercao.
//
// A DIFERENCA E QUE AGORA ISSO DEIXOU DE SER SOBRE MARCACAO
// ---------------------------------------------------------
// `SecaoDaTela` e funcao pura de props: ela desenha os botoes e chama de volta.
// Isso basta para provar QUAIS botoes aparecem (scripts/test-secao-da-tela.mjs,
// por `react-dom/server`), e nao basta para a assercao que importa: que clicar
// em "Confirmar" chama a rota certa E QUE A TELA REFLETE O RESULTADO -- a linha
// saindo de "Previsto no período" e aparecendo em "Realizado no período".
//
// Essa segunda metade exige tres coisas no MESMO componente: o estado da lista,
// a chamada da acao, e a RELEITURA depois dela. Enquanto as tres moravam no
// container com `next/navigation`, nada neste repositorio conseguia medir a
// diferenca entre "chamou a rota" e "o app refletiu o resultado" -- e os dois
// estados tem a mesma aparencia no instante do clique.
//
// Entao o que mudou de lugar foi A LEITURA, nao o cromo: `TelaDeMovimentacao`
// continua dona da URL (o periodo vive na querystring), do titulo, do seletor
// de periodo e dos links; este arquivo e dono do `fetch`, da lista, das acoes e
// do que se mostra quando a rede falha. `scripts/test-lista-na-tela.mjs` o monta
// em Chromium de verdade.
//
// POR QUE `confirm()` E NAO UM DIALOGO DE COMPONENTE
// --------------------------------------------------
// Tres razoes, e a primeira sozinha ja decidiria:
//
//   1. a pergunta de exclusao TEM DE SER MEDIDA. `@radix-ui/react-dialog` nao
//      tem build UMD e a sonda nao tem empacotador: o dialogo entraria como
//      esboco, e aí o que estaria provado seria o texto do esboco. Com
//      `confirm()`, a sonda substitui `window.confirm`, LE a frase que o app
//      passou e afirma sobre ela -- que e exatamente a regra desta issue ("o
//      diálogo tem de dizer qual das duas coisas vai acontecer");
//   2. e o que a lista de Financas Pessoais ja faz (`deleteTransaction` em
//      app/(dashboard)/dashboard/personal-finance/page.tsx). Duas perguntas
//      diferentes para a mesma operacao e o que esta issue nao deveria criar;
//   3. ele e bloqueante e nao tem estado: nao ha caminho em que a pergunta fique
//      aberta sobre uma linha que a releitura ja trocou.
//
// O TEXTO vem de `avisoDaExclusao` (lib/acoes-da-linha.ts), que e onde ele tem
// teste. Escrito aqui, ele passaria por qualquer suite de unidade intacto.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CartoesDaTela } from "@/components/movimentacoes/CartoesDaTela";
import {
  SecaoDaTela,
  type AcoesDaLinha,
  type AparenciaDaTela,
} from "@/components/movimentacoes/SecaoDaTela";
import {
  FaixaDadoDoAparelho,
  PainelErroDoServidor,
  PainelSemRede,
} from "@/components/SemRede";
import {
  avisoDaExclusao,
  caminhoDeEdicao,
  pedidoDeConfirmacao,
  pedidoDeEdicaoDaPrevista,
  pedidoDeExclusao,
  rotuloDeConfirmar,
  type EdicaoDaPrevista,
  type PedidoDaAcao,
} from "@/lib/acoes-da-linha";
import {
  buscarLeitura,
  podeAfirmarVazio,
  type EstadoDaLeitura,
} from "@/lib/offline-leitura";
import {
  secoesDaTela,
  type LinhaDaTela,
  type ResumoDaTela,
  type TelaDeMovimentacao as CatalogoDaTela,
  type TipoDaTela,
} from "@/lib/telas-de-movimentacao";

/** O que a rota responde. */
interface RespostaDaTela {
  resumo?: ResumoDaTela;
  vencido?: { total: number; quantidade: number };
  linhas?: LinhaDaTela[];
  fatura_sem_vencimento?: { account_name: string | null; total: number }[];
}

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valor);

/** 'AAAA-MM-DD' -> 'DD/MM/AAAA', por fatia. Nunca `new Date`. */
const dataLonga = (iso: string) =>
  iso && iso.length >= 10
    ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
    : iso;

/** O valor em reais no formato que o campo de texto aceita de volta. */
const paraOCampo = (valor: number) => valor.toFixed(2).replace(".", ",");

export function ListaDeMovimentacao({
  tipo,
  tela,
  aparencia,
  queryDoPeriodo,
  rotuloDoPeriodo,
  origem,
  rodape,
}: {
  tipo: TipoDaTela;
  tela: CatalogoDaTela;
  aparencia: AparenciaDaTela;
  /** `de=...&ate=...`, montado por `periodoParaQuery` no container. */
  queryDoPeriodo: string;
  /** "outubro de 2026", para a frase de secao vazia. */
  rotuloDoPeriodo: string;
  /** Esta tela COM o periodo, para a edicao saber para onde voltar (HMO-249). */
  origem: string | null;
  /**
   * O que vem depois das duas secoes.
   *
   * ENTRA POR PROP e nao mora aqui porque os dois pedacos dele dependem do
   * `router` (o "Ver <mes corrente>") -- e `next/navigation` neste arquivo
   * derrubaria a sonda de navegador no import. Como `ReactNode`, o container
   * monta e este componente so escolhe O LUGAR: dentro do ramo em que a leitura
   * deu certo, que e onde ele estava antes desta issue.
   */
  rodape?: React.ReactNode;
}) {
  const [resumo, setResumo] = useState<ResumoDaTela | null>(null);
  const [vencido, setVencido] = useState<{ total: number; quantidade: number }>({
    total: 0,
    quantidade: 0,
  });
  const [linhas, setLinhas] = useState<LinhaDaTela[]>([]);
  const [semVencimento, setSemVencimento] = useState<
    { account_name: string | null; total: number }[] | null
  >(null);
  const [estado, setEstado] = useState<EstadoDaLeitura | null>(null);
  const [guardadoEm, setGuardadoEm] = useState<Date | null>(null);
  const [carregando, setCarregando] = useState(true);

  /** O id da linha cuja acao esta em curso. Trava os botoes DELA e os outros. */
  const [agindo, setAgindo] = useState<string | null>(null);

  /** A conta prevista aberta no formulario em linha, e os tres campos dela. */
  const [editando, setEditando] = useState<LinhaDaTela | null>(null);
  const [campos, setCampos] = useState<EdicaoDaPrevista>({
    descricao: "",
    valor: "",
    vencimento: "",
  });

  const carregar = useCallback(async () => {
    setCarregando(true);

    const leitura = await buscarLeitura<RespostaDaTela>(
      `/api/movimentacoes/resumo?tipo=${tipo}&${queryDoPeriodo}`
    );

    setEstado(leitura.estado);
    setGuardadoEm(leitura.guardadoEm);

    if (leitura.dados) {
      setResumo(leitura.dados.resumo ?? null);
      setVencido(leitura.dados.vencido ?? { total: 0, quantidade: 0 });
      setLinhas(leitura.dados.linhas ?? []);
      // `?? null` e nao `?? []`: uma resposta guardada no aparelho de antes
      // desta feature nao tem o campo, e `[]` ali afirmaria "nenhum cartao sem
      // vencimento" com base num corpo que nunca respondeu isso.
      setSemVencimento(leitura.dados.fatura_sem_vencimento ?? null);
    } else {
      // A leitura falhou: a lista SAI da tela. Deixar a do periodo anterior
      // seria a tela mostrando setembro com o titulo de outubro.
      setResumo(null);
      setLinhas([]);
    }

    setCarregando(false);
  }, [tipo, queryDoPeriodo]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  /**
   * A leitura e SO-LEITURA? (`do-aparelho` e a resposta vinda do cache.)
   *
   * As tres acoes sao escrita, e escrita sem rede nao fica pendente neste
   * caminho -- ela FALHA. Botao habilitado em cima de uma lista que veio do
   * aparelho prometeria uma baixa que nao vai acontecer, e a linha continuaria
   * exatamente onde esta.
   */
  const online = estado === "fresco";

  /**
   * UM caminho para as tres acoes: dispara, e relê.
   *
   * A RELEITURA E A FEATURE, e nao limpeza depois dela. Sem ela, a baixa
   * responderia 200 e a linha ficaria em "Previsto no período" ate alguem trocar
   * de mes e voltar -- o app teria feito a coisa certa e dito o contrario. E
   * `carregar()` inteiro, e nao um remendo no array local: o lado realizado da
   * tela nao e um espelho da linha prevista (ela ganha outro id, outra data e
   * outra natureza), e um `setLinhas(linhas.map(...))` escrito aqui seria uma
   * SEGUNDA definicao do que a baixa produz -- que divergiria da rota na
   * primeira mudanca, mostrando um realizado plausivel e errado.
   */
  const disparar = useCallback(
    async (linha: LinhaDaTela, pedido: PedidoDaAcao, sucesso: string) => {
      setAgindo(linha.id);
      try {
        const resposta = await fetch(pedido.url, {
          method: pedido.metodo,
          ...(pedido.corpo
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(pedido.corpo),
              }
            : {}),
        });

        const dados = await resposta.json().catch(() => ({}));

        if (!resposta.ok) {
          // A mensagem da rota primeiro: ela e a unica que sabe POR QUE recusou
          // (conta ja paga, 409; serie que nao pode mudar de data, 400). Uma
          // frase generica aqui mandaria a pessoa tentar de novo o que nunca vai
          // funcionar. O status entra quando nao ha mensagem -- `undefined` num
          // toast se le como "o app travou".
          throw new Error(
            dados.error || `O pedido foi recusado (HTTP ${resposta.status}).`
          );
        }

        toast.success(sucesso);
        await carregar();
      } catch (erro) {
        console.error("Ação da linha de movimentação falhou:", erro);
        toast.error(
          erro instanceof Error && erro.message
            ? erro.message
            : "Não foi possível concluir a ação."
        );
      } finally {
        setAgindo(null);
      }
    },
    [carregar]
  );

  const aoConfirmar = useCallback(
    (linha: LinhaDaTela) => {
      const pedido = pedidoDeConfirmacao(linha);
      // `null` nao acontece pela tela (o botao so existe quando ele e nao-nulo),
      // e o `if` nao e zelo: ele e o que garante que nenhum caminho monte
      // `/api/scheduled-transactions/fatura:2026-08-01:<uuid>/pay` a partir da
      // chave sintetica da fatura aberta -- um 404 que se le como "o app nao
      // conseguiu".
      if (!pedido) return;

      // "Pago ou recebido" e UMA acao e TRES rotulos: o verbo segue a direcao da
      // linha, e o toast repete o mesmo verbo do botao. Dizer "pagamento"
      // depois de confirmar um salario faria a tela desmentir o botao.
      void disparar(linha, pedido, `${rotuloDeConfirmar(linha.tipo)}: feito.`);
    },
    [disparar]
  );

  const aoExcluir = useCallback(
    (linha: LinhaDaTela) => {
      const pedido = pedidoDeExclusao(linha);
      const aviso = avisoDaExclusao(linha, linha.descricao);
      if (!pedido || !aviso) return;

      // TODA ACAO DESTRUTIVA PERGUNTA ANTES DE SAIR. E a pergunta DIZ QUAL DAS
      // DUAS COISAS VAI ACONTECER: tirar a ocorrencia de um gasto fixo da agenda
      // (a regra continua gerando) nao e excluir a regra, e as duas respondem
      // 200 e tiram a linha da tela -- nada no app distingue uma da outra depois
      // do clique.
      if (!confirm(aviso)) return;

      void disparar(linha, pedido, "Pronto: a linha saiu da lista.");
    },
    [disparar]
  );

  /** Abre o formulario em linha de uma conta prevista, com os valores de hoje. */
  const aoEditar = useCallback((linha: LinhaDaTela) => {
    setEditando(linha);
    setCampos({
      descricao: linha.descricao ?? "",
      valor: paraOCampo(linha.valor),
      vencimento: linha.data,
    });
  }, []);

  const salvarEdicao = useCallback(async () => {
    const linha = editando;
    if (!linha) return;

    const resultado = pedidoDeEdicaoDaPrevista(linha, campos);
    if ("erro" in resultado) {
      // A recusa vem da lib e nao da rota de proposito: as tres sao 400 com
      // texto, e uma delas e silenciosa de outra forma -- campo vazio vira
      // `Number("") === 0`, que nao e `NaN` e passa por qualquer `isNaN`.
      toast.error(resultado.erro);
      return;
    }

    setEditando(null);
    await disparar(linha, resultado.pedido, "Conta prevista atualizada.");
  }, [editando, campos, disparar]);

  const { previstas, realizadas } = useMemo(
    () => secoesDaTela(linhas),
    [linhas]
  );

  /**
   * O objeto que a secao recebe. Em `useMemo` porque ele e prop de componente:
   * um literal novo a cada render invalidaria qualquer memoizacao futura da
   * secao, e o custo de manter a identidade estavel aqui e uma linha.
   */
  const acoes: AcoesDaLinha = useMemo(
    () => ({
      hrefDeEdicao: (linha) => caminhoDeEdicao(linha, tela.rota, origem),
      aoEditar,
      aoExcluir,
      aoConfirmar,
      agindo,
      online,
    }),
    [tela.rota, origem, aoEditar, aoExcluir, aoConfirmar, agindo, online]
  );

  return (
    <>
      {estado === "do-aparelho" && (
        <FaixaDadoDoAparelho
          guardadoEm={guardadoEm}
          soLeitura
          aoTentarDeNovo={carregar}
        />
      )}

      {estado === "sem-rede" ? (
        <PainelSemRede
          oQue={`as ${tela.titulo.toLowerCase()} do período`}
          aoTentarDeNovo={carregar}
        />
      ) : estado === "erro-do-servidor" ? (
        <PainelErroDoServidor
          oQue={`as ${tela.titulo.toLowerCase()} do período`}
          aoTentarDeNovo={carregar}
        />
      ) : (
        <>
          <CartoesDaTela
            tela={tela}
            cor={aparencia.cor}
            resumo={resumo}
            vencido={vencido}
            estado={estado}
          />

          {/*
            A FATURA SEM DATA DE VENCIMENTO (HMO-227)
            Sem `due_day` no cartao o banco nao calcula vencimento, e a fatura
            NAO pode virar linha prevista. Omitir isso deixaria o "Previsto"
            desta tela ignorando um cartao inteiro, sem nada dizendo que ele foi
            ignorado -- um numero menor e plausivel.
          */}
          {tipo === "expense" &&
            semVencimento !== null &&
            semVencimento.length > 0 && (
              <Card className="border-warning/40">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CreditCard className="h-4 w-4 text-warning" />
                    Fatura de cartão fora do previsto
                  </CardTitle>
                  <CardDescription>
                    Estes cartões têm fatura aberta e nenhum dia de vencimento
                    configurado. Sem ele não há data para calcular, e o app não
                    inventa uma — então o valor abaixo está FORA do Previsto.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {semVencimento.map((cartao, i) => (
                    <div
                      key={`${cartao.account_name ?? "cartao"}|${i}`}
                      className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0"
                    >
                      <p className="font-medium text-foreground">
                        {cartao.account_name ?? "Cartão de crédito"}
                      </p>
                      <div className="flex items-center gap-3">
                        <p className="font-semibold">{moeda(cartao.total)}</p>
                        <Button size="sm" variant="outline" asChild>
                          <Link href="/dashboard/cartoes">Configurar</Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

          {/*
            O FORMULARIO EM LINHA DE UMA CONTA PREVISTA (HMO-301)

            Em cima das secoes e nao dentro da linha, por duas razoes. A primeira
            e de layout: tres campos dentro de uma linha de 320px de celular ou
            viram ilegiveis ou empurram o valor para fora da tela. A segunda e
            que a releitura TROCA o array de linhas -- um formulario montado
            dentro de `SecaoDaTela` perderia o que estava digitado em qualquer
            recarga, e esta tela recarrega depois de cada acao.

            Nao e um `Dialog`: ver o cabecalho deste arquivo. A conta prevista
            nao tem tela de edicao propria (`?id=` do formulario completo le
            `financial_transactions`), e mandar a pessoa para Contas a Pagar
            tiraria dela o periodo que ela estava olhando.
          */}
          {editando && (
            <Card className="border-primary/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Editar conta prevista
                </CardTitle>
                <CardDescription>
                  {/*
                    O ALCANCE ESCRITO, e nao implicito. `apenas_esta` muda esta
                    ocorrencia e NAO a regra: o aluguel reajustado so neste mes
                    volta ao valor antigo nos proximos, e sem esta frase ninguem
                    liga uma coisa a outra. Para mudar a serie, Contas a Pagar
                    pergunta o alcance (HMO-228).
                  */}
                  Vale só para a ocorrência de{" "}
                  <strong>{dataLonga(editando.data)}</strong>.
                  {editando.natureza === "fixa" && (
                    <>
                      {" "}
                      Este é um gasto <strong>fixo</strong>: as próximas
                      ocorrências continuam com o valor de antes — para mudar a
                      série inteira, use Contas a Pagar.
                    </>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="space-y-1 text-sm">
                    <span className="text-muted-foreground">Descrição</span>
                    <input
                      id="edicao-descricao"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={campos.descricao}
                      onChange={(e) =>
                        setCampos((c) => ({ ...c, descricao: e.target.value }))
                      }
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-muted-foreground">Valor (R$)</span>
                    {/*
                      `type="text"` e NAO `type="number"`: o nativo DESCARTA a
                      virgula enquanto se digita (medido na HMO-271), e
                      "1.234,56" chega no handler como "1.234". Quem converte e
                      `pedidoDeEdicaoDaPrevista`, que tem teste.
                    */}
                    <input
                      id="edicao-valor"
                      inputMode="decimal"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={campos.valor}
                      onChange={(e) =>
                        setCampos((c) => ({ ...c, valor: e.target.value }))
                      }
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-muted-foreground">Vencimento</span>
                    <input
                      id="edicao-vencimento"
                      type="date"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={campos.vencimento}
                      onChange={(e) =>
                        setCampos((c) => ({ ...c, vencimento: e.target.value }))
                      }
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    id="edicao-salvar"
                    size="sm"
                    onClick={() => void salvarEdicao()}
                    disabled={agindo !== null || !online}
                  >
                    {agindo !== null && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Salvar
                  </Button>
                  <Button
                    id="edicao-cancelar"
                    size="sm"
                    variant="outline"
                    onClick={() => setEditando(null)}
                  >
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <SecaoDaTela
            titulo="Previsto no período"
            icone={<CalendarClock className="h-4 w-4 text-warning" />}
            subtitulo={tela.oQueOPrevistoE}
            linhas={previstas}
            carregando={carregando}
            vazio={
              podeAfirmarVazio(estado)
                ? "Nada previsto neste período."
                : "Não dá para conferir o previsto agora."
            }
            aparencia={aparencia}
            acoes={acoes}
          />

          <SecaoDaTela
            titulo="Realizado no período"
            icone={<CheckCircle2 className="h-4 w-4 text-success" />}
            subtitulo={tela.oQueORealizadoE}
            linhas={realizadas}
            carregando={carregando}
            vazio={
              podeAfirmarVazio(estado)
                ? `Nenhum lançamento em ${rotuloDoPeriodo}.`
                : "Não dá para conferir o realizado agora."
            }
            aparencia={aparencia}
            acoes={acoes}
          />

          {rodape}
        </>
      )}
    </>
  );
}
