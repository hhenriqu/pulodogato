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
import { CampoDeData } from "@/components/ui/campo-de-data";
// `formatCurrency` E NAO UM `moeda` PROPRIO, e a razao nao e so DRY: este
// arquivo e `SecaoDaTela.tsx` sao CONCATENADOS num script classico pela sonda de
// scripts/test-lista-na-tela.mjs, e dois `const moeda` de modulo com o mesmo
// nome em partes diferentes sao SyntaxError do script inteiro -- cujo sintoma e
// "a pagina nao reportou nada", vinte linhas depois e sem o nome do arquivo.
// Ter UM formatador de moeda tambem e simplesmente melhor: e o mesmo que
// `PainelDePapel` usa.
import { formatCurrency } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CartoesDaTela } from "@/components/movimentacoes/CartoesDaTela";
import { PainelPraQuemPagar } from "@/components/movimentacoes/PainelPraQuemPagar";
import type { DestinoDoPagamento } from "@/lib/pra-quem-pagar";
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
import { DialogoDePagamentoDaFatura } from "@/components/fatura/DialogoDePagamentoDaFatura";
// O MESMO dialogo da tela do grupo, e nao um seletor de conta novo (HMO-366): o
// dado que falta e o mesmo -- de qual conta o dinheiro veio --, e ele ja filtra
// as contas elegiveis pela MESMA funcao que o servidor usa (`contasParaOAcerto`,
// por dentro). Um seletor proprio aqui seria a segunda lista de contas
// elegiveis, e a divergencia apareceria como opcao que o POST recusa.
import {
  DialogoDeAcerto,
  type ContaParaEscolher,
} from "@/components/grupos/DialogoDeAcerto";
import {
  ACERTO_FORA_DO_PREVISTO,
  ACERTO_FORA_DO_REALIZADO,
  SUBTITULO_A_CONFIRMAR,
  TITULO_A_CONFIRMAR,
  TITULO_CONFIRMADO,
  type AcertoNaAbaReceitas,
  type AcertosNaAbaReceitas,
} from "@/lib/acerto-na-aba-receitas";
import {
  FATURA_SEM_VENCIMENTO_NAO_TEM_PAGAR,
  linhaParaPagarDaTela,
} from "@/lib/pagamento-da-fatura";
import {
  buscarLeitura,
  podeAfirmarVazio,
  podeMostrarNumero,
  type EstadoDaLeitura,
} from "@/lib/offline-leitura";
import { today } from "@/lib/recurrence";
import {
  secoesDaTela,
  type LinhaDaTela,
  type ResumoComReembolso,
  type TelaDeMovimentacao as CatalogoDaTela,
  type TipoDaTela,
} from "@/lib/telas-de-movimentacao";

/** O que a rota responde. */
interface RespostaDaTela {
  /**
   * O resumo COM o reembolso previsto do grupo -- HMO-364.
   *
   * `ResumoComReembolso` e nao `ResumoDaTela`: o reembolso entra DENTRO de
   * `previsto` na aba Receitas, e o campo ao lado e o unico jeito de a tela
   * dizer que ele esta ali. Tipar isto como `ResumoDaTela` nao quebraria o
   * tsc (`res.json()` e `any`) -- o campo chegaria e ninguem o leria, e o
   * cartao subiria sem rotulo.
   */
  resumo?: ResumoComReembolso;
  vencido?: { total: number; quantidade: number };
  linhas?: LinhaDaTela[];
  fatura_sem_vencimento?: { account_name: string | null; total: number }[];
  /**
   * OS ACERTOS DE GRUPO DA ABA RECEITAS -- HMO-366.
   *
   * Campo PROPRIO, fora de `resumo` e de `linhas`: nenhum dos valores entra em
   * cartao nenhum (as duas razoes estao em lib/acerto-na-aba-receitas.ts) e
   * fabricar `LinhaDaTela` para eles daria a cada um os tres botoes de
   * `posso_editar` sobre um id que nao existe em `scheduled_transactions` --
   * `UPDATE` recusado pela RLS volta 200 sem alterar nada, ou seja o app diria
   * "pronto" e nada teria acontecido.
   */
  acertos_do_grupo?: AcertosNaAbaReceitas | null;
  /**
   * PRA QUEM PAGAR -- HMO-365, so na aba Despesas.
   *
   * Ausente no corpo guardado pelo PWA de antes desta issue, e por isso o `??
   * []` na leitura: o painel simplesmente nao aparece, que e o mesmo estado de
   * quem nao tem grupo.
   */
  pra_quem_pagar?: DestinoDoPagamento[];
}

/** 'AAAA-MM-DD' -> 'DD/MM/AAAA', por fatia. Nunca `new Date`. */
const dataLonga = (iso: string) =>
  iso && iso.length >= 10
    ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
    : iso;

/** O valor em reais no formato que o campo de texto aceita de volta. */
const paraOCampo = (valor: number) => valor.toFixed(2).replace(".", ",");

// HOJE vem de `today()` (lib/recurrence.ts), E NAO DE UM RELOGIO PROPRIO AQUI.
//
// Duas razoes, e a segunda e a que custa dinheiro:
//
//   * `today()` ja e "hoje em 'AAAA-MM-DD', no fuso de Sao Paulo" -- o fuso ONDE
//     OS VENCIMENTOS VIVEM. Um `new Date().toISOString()` daria o dia do
//     APARELHO (ou da Vercel, que e UTC), e depois das 21h ele muda o DIA: o
//     `paid_date` da fatura cairia no mes vizinho sem nada na tela parecendo
//     errado;
//   * uma segunda definicao de "hoje" divergiria da primeira, e `today()` e
//     justamente quem decide os vencimentos com que esta lista e comparada.
//
// E ela e CHAMADA NO RENDER, nao congelada num `const` de modulo como o `HOJE`
// de `app/.../bills/page.tsx`: este app e instalado (next-pwa) e fica semanas na
// mesma aba. Congelado, depois da meia-noite ele mandaria a data de ontem.
//
// `lib/recurrence` NAO E PESO NOVO NO BUNDLE: `TelaDeMovimentacao.tsx` -- o
// container desta lista, tambem `"use client"` -- ja o importa.

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
  const [resumo, setResumo] = useState<ResumoComReembolso | null>(null);
  const [vencido, setVencido] = useState<{ total: number; quantidade: number }>({
    total: 0,
    quantidade: 0,
  });
  const [linhas, setLinhas] = useState<LinhaDaTela[]>([]);
  const [semVencimento, setSemVencimento] = useState<
    { account_name: string | null; total: number }[] | null
  >(null);
  /**
   * OS ACERTOS DE GRUPO DESTA ABA -- HMO-366.
   *
   * `null` = esta resposta nao fala de acerto. Nao e o mesmo que vazio, e a
   * diferenca e a mesma de `semVencimento` logo acima: uma resposta guardada no
   * aparelho de antes desta feature nao tem o campo, e um `{a_confirmar: []}`
   * ali afirmaria "voce nao tem nada a confirmar" com base num corpo que nunca
   * respondeu isso.
   */
  const [acertos, setAcertos] = useState<AcertosNaAbaReceitas | null>(null);
  /**
   * PRA QUEM PAGAR -- HMO-365. `[]` e nao `null`: aqui a lista vazia e a
   * resposta sem o campo significam a MESMA coisa para a tela (nenhum painel),
   * ao contrario de `semVencimento`, onde `[]` seria uma afirmacao.
   */
  const [praQuemPagar, setPraQuemPagar] = useState<DestinoDoPagamento[]>([]);
  const [estado, setEstado] = useState<EstadoDaLeitura | null>(null);
  const [guardadoEm, setGuardadoEm] = useState<Date | null>(null);
  const [carregando, setCarregando] = useState(true);

  /** O id da linha cuja acao esta em curso. Trava os botoes DELA e os outros. */
  const [agindo, setAgindo] = useState<string | null>(null);

  /**
   * A FATURA QUE O DIALOGO DE PAGAMENTO ESTA PERGUNTANDO -- HMO-311.
   *
   * `null` mantem o dialogo fechado. E a LINHA inteira, e nao o id: o dialogo
   * mostra a descricao, o valor e o vencimento dela, e a decisao de uma ou duas
   * escritas sai de `gravada` -- com o id so, a tela teria de procurar a linha
   * de novo num array que a releitura troca.
   */
  const [faturaParaPagar, setFaturaParaPagar] = useState<LinhaDaTela | null>(
    null
  );

  /**
   * O ACERTO CUJA CONTA O DIALOGO ESTA PERGUNTANDO -- HMO-366.
   *
   * `null` mantem o dialogo fechado. E a LINHA inteira e nao o id, pelo motivo
   * de `faturaParaPagar` acima: o dialogo mostra o valor, a moeda, a cotacao e
   * o nome de quem pagou, e com o id so a tela teria de procurar a linha de
   * novo num array que a releitura troca.
   */
  const [acertoEmCurso, setAcertoEmCurso] =
    useState<AcertoNaAbaReceitas | null>(null);

  /** As MINHAS contas, lidas quando o dialogo do acerto abre. */
  const [contasDoAcerto, setContasDoAcerto] = useState<ContaParaEscolher[]>([]);

  /** O id do acerto cuja confirmacao esta em voo. Trava o botao DELE. */
  const [acertoSalvando, setAcertoSalvando] = useState<string | null>(null);

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
      // `?? null` pelo mesmo motivo da linha acima: resposta antiga do aparelho
      // nao tem o campo, e afirmar "nada a confirmar" com base nela esconderia
      // um Pix que ja esta na conta de alguem.
      setAcertos(leitura.dados.acertos_do_grupo ?? null);
      setPraQuemPagar(leitura.dados.pra_quem_pagar ?? []);
    } else {
      // A leitura falhou: a lista SAI da tela. Deixar a do periodo anterior
      // seria a tela mostrando setembro com o titulo de outubro.
      setResumo(null);
      setLinhas([]);
      setAcertos(null);
      // Pelo MESMO motivo das duas acima: um painel "pague R$ 300 para a
      // Leticia" sobrevivendo a uma leitura que falhou e uma divida afirmada
      // sobre o periodo ANTERIOR, debaixo do titulo do novo.
      setPraQuemPagar([]);
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

  /**
   * Abre o dialogo da conta pagadora. NAO ESCREVE NADA -- HMO-311.
   *
   * Nenhuma rede aqui de proposito: a pergunta "de qual conta o dinheiro saiu?"
   * nao tem resposta padrao (`validarContaPagadora` recusa cair num padrao, e
   * diz por que: lancaria dinheiro saindo de uma conta que a pessoa nao
   * escolheu, e o saldo errado seria descoberto semanas depois). Quem escreve,
   * depois da escolha, e `pagarAFatura` por dentro do dialogo.
   *
   * E NAO E `disparar`: aquele caminho monta UM pedido e relê. A fatura aberta
   * sao DUAS escritas na ordem certa, com o 409 do `close` que nao e erro -- e
   * tratar isso aqui seria a segunda implementacao da de-duplicacao de fatura,
   * divergindo de Contas a Pagar na primeira correcao.
   */
  const aoPagarFatura = useCallback((linha: LinhaDaTela) => {
    setFaturaParaPagar(linha);
  }, []);

  /**
   * ABRE O DIALOGO DA CONTA DO ACERTO. NAO ESCREVE NADA -- HMO-366.
   *
   * A pergunta "em qual conta o dinheiro entrou?" nao tem resposta padrao, e e
   * a mesma recusa do dialogo da fatura logo acima: escolher a primeira conta
   * da lista poria dinheiro numa conta que a pessoa nao escolheu, e o erro
   * apareceria semanas depois no extrato de uma conta que ela nao estava
   * olhando. A rota tambem recusa um POST sem `account_id`.
   *
   * As contas sao lidas AQUI e nao no render: `/api/financial-accounts` por
   * linha da lista seria uma consulta por acerto, e a lista de contas nao muda
   * entre eles. Falhar na leitura NAO impede o dialogo de abrir -- ele diz, com
   * a frase que a propria lib escreve, que nao ha conta elegivel.
   */
  const aoConfirmarAcerto = useCallback(async (acerto: AcertoNaAbaReceitas) => {
    setAcertoEmCurso(acerto);

    try {
      const resposta = await fetch("/api/financial-accounts");
      const dados = await resposta.json();
      setContasDoAcerto(Array.isArray(dados.accounts) ? dados.accounts : []);
    } catch (erro) {
      console.error("Não foi possível carregar as contas do acerto:", erro);
      setContasDoAcerto([]);
      toast.error("Não foi possível carregar suas contas");
    }
  }, []);

  /**
   * GRAVA A MINHA PERNA DO ACERTO, na conta escolhida -- HMO-366.
   *
   * E A ROTA QUE JA EXISTE (`settlements/[id]/perna`, HMO-245 fase 12), sem uma
   * linha de regra nova: ela e quem confere "sou parte?" e "ja lancei?" pela
   * mesma funcao pura da tela do grupo, e quem grava a perna como `transfer`
   * com `group_id: null` literal. As duas coisas tem medicao atras delas, e
   * reimplementar o insert aqui perderia as duas de uma vez -- um insert
   * negativo com `group_id` e RATEADO pelo trigger (medido: 2 partes de R$ 400
   * viram 4 somando R$ 600), ou seja pagar divida criaria divida nova.
   *
   * NAO E `disparar`: aquele caminho recebe uma `LinhaDaTela`, monta UM pedido
   * a partir dela e trava o botao por `linha.id`. Aqui o pedido depende da
   * conta que a pessoa acabou de escolher no dialogo, e o alvo nao e uma linha
   * da lista. O que e igual -- a mensagem da ROTA primeiro e a RELEITURA depois
   * -- esta igual de proposito.
   *
   * A RELEITURA E A FEATURE. Sem ela a linha ficaria no bloco "a confirmar"
   * depois de um 200, e o segundo clique responderia 409 em cima de uma
   * operacao que deu certo.
   */
  const lancarMinhaPerna = useCallback(
    async (contaId: string) => {
      const acerto = acertoEmCurso;
      if (!acerto) return;

      setAcertoSalvando(acerto.settlementId);
      try {
        const resposta = await fetch(
          `/api/expense-groups/${acerto.groupId}/settlements/${acerto.settlementId}/perna`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account_id: contaId }),
          }
        );

        const dados = await resposta.json().catch(() => ({}));

        if (!resposta.ok) {
          throw new Error(
            dados.error || `O pedido foi recusado (HTTP ${resposta.status}).`
          );
        }

        setAcertoEmCurso(null);
        toast.success("Acerto lançado na sua conta.");
        await carregar();
      } catch (erro) {
        console.error("Erro ao lançar a perna do acerto:", erro);
        toast.error(
          erro instanceof Error && erro.message
            ? erro.message
            : "Não foi possível lançar o acerto na sua conta."
        );
      } finally {
        setAcertoSalvando(null);
      }
    },
    [acertoEmCurso, carregar]
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
      // `aparencia.rotaDeLancar` E NAO `tela.rota`: a primeira e o FORMULARIO
      // (/dashboard/movimentacoes/despesa), que sabe ler `?id=`; a segunda e
      // esta propria lista (/dashboard/despesas), que ignora o parametro. Com a
      // segunda o Editar recarregaria a tela e o clique nao faria nada visivel
      // -- medido por `npm run test:lista-na-tela`, no codigo intacto.
      hrefDeEdicao: (linha) =>
        caminhoDeEdicao(linha, aparencia.rotaDeLancar, origem),
      aoEditar,
      aoExcluir,
      aoConfirmar,
      aoPagarFatura,
      agindo,
      online,
      // O ELO DA FATURA RECARREGA A LISTA INTEIRA -- HMO-305, e e `carregar` e
      // nao um `setX` local de proposito: quem de-duplica a fatura e a LEITURA
      // (`sintetizarFaturasAbertas`, na rota), entao o numero novo so existe
      // depois de reler. Mexer na lista do lado do cliente seria a segunda
      // aritmetica da de-duplicacao -- exatamente o que esta issue nao escreve.
      aoConcluirElo: carregar,
    }),
    [
      aparencia.rotaDeLancar,
      origem,
      aoEditar,
      aoExcluir,
      aoConfirmar,
      aoPagarFatura,
      agindo,
      online,
      carregar,
    ]
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
            PRA QUEM PAGAR (HMO-365, fase F2 da HMO-360)

            Debaixo dos cartoes e NAO como um quarto cartao: o valor ja esta
            dentro do «Previsto» (a regra do pagador pos a minha parte la), e um
            cartao a mais na fileira seria lido como uma segunda divida. O
            proprio painel diz isso por escrito.

            `podeMostrarNumero` tambem aqui, e pelo motivo do vencido e do
            reembolso em `CartoesDaTela`: "pague R$ 300 para a Leticia" dito
            sobre um cache de ontem pode ja ter sido pago. O componente devolve
            `null` com a lista vazia, entao quem nao tem grupo nao ve nada.
          */}
          {tipo === "expense" && podeMostrarNumero(estado) && (
            <PainelPraQuemPagar destinos={praQuemPagar} />
          )}

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
                    inventa uma — então o valor abaixo está FORA do Previsto.{" "}
                    {/*
                      A FRASE OBRIGATORIA DA HMO-311. Desde esta fase a linha da
                      fatura NA LISTA tem botao "Pagar", e esta nao tem -- ela
                      vem com `{ account_name, total }` e nada mais, sem id e sem
                      `accountId`. "A fatura do Nubank tem botão e a do C6 não"
                      se lê como tela quebrada, e manda recarregar a página em
                      vez de cadastrar o dia de vencimento, que é o caminho.
                    */}
                    {FATURA_SEM_VENCIMENTO_NAO_TEM_PAGAR}
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
                        <p className="font-semibold">{formatCurrency(cartao.total)}</p>
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
                    {/*
                      `CampoDeData` e NAO o controle nativo: a ordem dos tres
                      segmentos do `type="date"` sai do APARELHO, e o mesmo app
                      mostra dd/mm para um usuario e mm/dd para outro sem nada
                      na tela dizendo qual (medido na HMO-238). Quem digitasse
                      10 de MARCO aqui gravaria 3 de OUTUBRO -- data valida,
                      plausivel e sem erro nenhum no caminho, que e o defeito
                      que so aparece meses depois num extrato que nao fecha.

                      Ele MOSTRA dd/mm/aaaa e EMITE AAAA-MM-DD, que e o que
                      `salvarEdicao` manda para o banco: o `onChange` recebe a
                      data ja em ISO, nao um evento.
                    */}
                    <CampoDeData
                      id="edicao-vencimento"
                      value={campos.vencimento}
                      onChange={(vencimento) =>
                        setCampos((c) => ({ ...c, vencimento }))
                      }
                      aria-label="Vencimento"
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

          {/*
            "ELA PAGOU; EU CONFIRMO" -- HMO-366, fase F4 da HMO-360.

            BLOCO PROPRIO, ENTRE AS DUAS SECOES, E NAO LINHA DENTRO DELAS.
            Tres razoes, e a primeira sozinha decidiria:

              1. o valor NAO entra no cartao «Previsto» (ele ja esta lá dentro,
                 como reembolso previsto da F3 -- `fecharMes` nao desconta
                 acerto registrado), e uma linha DENTRO da secao cujo numero e o
                 cartao se le como parte daquele numero. A frase
                 `ACERTO_FORA_DO_PREVISTO` e o que torna isso legivel;
              2. a acao e OUTRA. `pedidoDeConfirmacao` monta
                 `/api/scheduled-transactions/<id>/pay`, e esta linha nao e uma
                 conta prevista -- o botao certo e o POST da perna, com a conta
                 escolhida no dialogo. Para por essas linhas em `SecaoDaTela`
                 seria preciso ensinar `lib/acoes-da-linha.ts` a devolver dois
                 pedidos diferentes, e o modo de falha disso e o botao errado em
                 cima da linha certa;
              3. `LinhaDaTela` exige `posso_editar`/`gravada`, e fabricar isso
                 aqui daria Editar e Excluir sobre um id que nao existe em
                 `scheduled_transactions`.

            O BLOCO SO EXISTE QUANDO HA LINHA. `acertos` e `null` quando a
            resposta nao fala de acerto (ou veio do aparelho), e um card vazio
            dizendo "nada a confirmar" seria o zero confiante desta tela.
          */}
          {acertos && acertos.a_confirmar.length > 0 && (
            <Card className="border-warning/40">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarClock className="h-4 w-4 text-warning" />
                  {TITULO_A_CONFIRMAR}
                </CardTitle>
                <CardDescription>
                  {SUBTITULO_A_CONFIRMAR} {ACERTO_FORA_DO_PREVISTO}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {acertos.a_confirmar.map((acerto) => (
                  <div
                    key={acerto.id}
                    className="flex flex-col gap-2 border-b border-border py-2 last:border-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {acerto.descricao}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {dataLonga(acerto.data)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="font-semibold">
                        {formatCurrency(acerto.valor, acerto.moeda)}
                      </p>
                      <Button
                        size="sm"
                        id={`confirmar-acerto-${acerto.settlementId}`}
                        onClick={() => void aoConfirmarAcerto(acerto)}
                        // `!online` pelo mesmo motivo das tres acoes da linha:
                        // escrita sem rede nao fica pendente neste caminho, ela
                        // FALHA -- e um botao habilitado em cima de uma lista
                        // que veio do aparelho prometeria um lancamento que nao
                        // vai acontecer.
                        disabled={acertoSalvando !== null || !online}
                      >
                        {acertoSalvando === acerto.settlementId && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Confirmar
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

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

          {/*
            O ACERTO JA CONFIRMADO, QUE E A PEGADINHA DE UX DESTA FASE -- HMO-366.

            A perna e `transfer` (`TIPO_DA_PERNA`), e `transfer` NAO entra em
            Receitas realizadas: sem este bloco, confirmar faria a linha
            DESAPARECER da tela -- ela sai do bloco de cima e nao aparece em
            baixo. "Cliquei e o valor sumiu" e indistinguivel de bug, e o caminho
            dessa estranheza termina em alguem lancando a receita a mao para
            "consertar", que e a conta duas vezes que a 007 recusou.

            E o rotulo diz POR QUE o cartao «Realizado» nao subiu
            (`ACERTO_FORA_DO_REALIZADO`). Sem a frase, o bloco seria um valor a
            mais sem explicacao ao lado de um numero que nao se mexeu -- a
            familia `despesa-de-grupo-tem-tres-convencoes` outra vez.
          */}
          {acertos && acertos.confirmados.length > 0 && (
            <Card className="border-success/40">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  {TITULO_CONFIRMADO}
                </CardTitle>
                <CardDescription>{ACERTO_FORA_DO_REALIZADO}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {acertos.confirmados.map((acerto) => (
                  <div
                    key={acerto.id}
                    className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {acerto.descricao}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {dataLonga(acerto.data)}
                      </p>
                    </div>
                    {/*
                      SEM BOTAO AQUI, e a ausencia e decisao: remover a propria
                      perna existe (`DELETE` da mesma rota), mas ela e uma acao
                      sobre o EXTRATO, e o lugar dela e onde a quitacao esta --
                      a tela do grupo, que mostra as duas ao lado dos nomes e do
                      saldo. Um "desfazer" aqui, longe daquele contexto, convida
                      a tirar o lancamento de um Pix que de fato aconteceu.
                    */}
                    <p className="font-semibold text-success">
                      {formatCurrency(acerto.valor, acerto.moeda)}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {rodape}

          {/*
            PAGAR A FATURA, PELA TELA DE DESPESAS -- HMO-311 (fase 14).

            O dialogo e o da HMO-310, SEM UMA LINHA COPIADA: ele busca as contas
            ao abrir, recusa o Confirmar sem conta escolhida com a mensagem que a
            propria rota devolveria, e diz -- antes e depois do clique -- que o
            patrimonio nao muda, porque quem paga R$ 1.000 e ve o patrimonio
            parado conclui que a tela nao registrou e paga de novo.

            `linhaParaPagarDaTela` NAO E ADAPTADOR DE CONVENIENCIA: o `id` da
            fatura ABERTA nesta tela e a chave sintetica
            (`fatura:2026-10-01:<uuid>`), e passa-la como id de banco montaria
            `POST /api/scheduled-transactions/fatura:.../pay` -- 404. Ver o
            cabecalho dela.

            E `aoPagar` RECEBE `carregar`, QUE E A FEATURE e nao limpeza: quem de-duplica a
            fatura e a LEITURA (`sintetizarFaturasAbertas`, na rota), entao a
            linha so sai do «Previsto» depois de reler. Um `setLinhas` local
            seria a SEGUNDA aritmetica da mesma regra -- o mesmo motivo de
            `aoConcluirElo`, logo acima.

            O valor e o vencimento vao JA FORMATADOS, e `hoje` no fuso de Sao
            Paulo: o componente nao tem relogio nem formatador proprio.
          */}
          <DialogoDePagamentoDaFatura
            linha={
              faturaParaPagar ? linhaParaPagarDaTela(faturaParaPagar) : null
            }
            valorFormatado={
              faturaParaPagar ? formatCurrency(faturaParaPagar.valor) : ""
            }
            vencimentoFormatado={
              faturaParaPagar ? dataLonga(faturaParaPagar.data) : ""
            }
            hoje={today()}
            aoFechar={() => setFaturaParaPagar(null)}
            aoPagar={carregar}
          />

          {/*
            A CONTA DA MINHA PERNA DO ACERTO -- HMO-366.

            O MESMO dialogo da tela do grupo (`DialogoDeAcerto`, HMO-245 fase
            12), com o mesmo titulo e o mesmo rotulo de botao que a contraparte
            ja ve lá: aqui nao se registra acerto nenhum -- ele ja esta
            registrado --, e "Registrar acerto" sugeriria que clicar de novo
            registra um segundo pagamento.

            `direcao="recebi"` LITERAL, e nao um campo da linha: por construcao
            `acertosNaAbaReceitas` so devolve acerto em que EU sou
            `to_user_id` (e e `comoEuVejoOAcerto` quem decide isso). Um campo
            aqui seria uma segunda fonte para a mesma direcao, e o defeito dela
            e o sinal invertido -- a perna sairia NEGATIVA, tirando da conta o
            dinheiro que entrou.

            `aviso` nao vem, pelo mesmo motivo da tela do grupo: a sobra de
            centavo e da DIVISAO do valor na moeda da viagem, decidida quando o
            acerto foi registrado. Aqui o valor ja esta gravado.
          */}
          {acertoEmCurso && (
            <DialogoDeAcerto
              aberto={true}
              aoFechar={() => setAcertoEmCurso(null)}
              direcao="recebi"
              nomeDaContraparte={acertoEmCurso.nomeDaContraparte}
              valor={acertoEmCurso.valor}
              moeda={acertoEmCurso.moeda}
              cotacao={acertoEmCurso.cotacao}
              contas={contasDoAcerto}
              titulo="Lançar o que recebi"
              rotuloDoBotao="Lançar na minha conta"
              rotuloSalvando="Lançando..."
              aoConfirmar={lancarMinhaPerna}
              salvando={acertoSalvando === acertoEmCurso.settlementId}
            />
          )}
        </>
      )}
    </>
  );
}
