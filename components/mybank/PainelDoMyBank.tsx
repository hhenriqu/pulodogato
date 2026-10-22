"use client";

// ---------------------------------------------------------------------------
// A TELA DO MYBANK -- /dashboard/mybank (HMO-371, F3 da HMO-368)
// ---------------------------------------------------------------------------
// Uma conta de investimento minha virando banco: ela empresta, e a divida volta
// parcelada -- para mim mesmo (Caso A) ou para uma conexao (Caso B).
//
// A TELA NAO DECIDE NADA DE DINHEIRO
// ----------------------------------
// A aritmetica e de `lib/lancamento.ts` (`serieDeParcelas`, `resumoDaSerie`), a
// regra de quais pernas cada caso gera e de `lib/emprestimo-do-mybank.ts` (F2),
// e os recortes desta tela sao de `lib/mybank-na-tela.ts`. Aqui ficam o gesto, a
// chamada e a frase -- e e deliberado: um `if (base === "total")` com uma
// multiplicacao ao lado dentro deste arquivo seria a terceira aritmetica de
// parcela do app, e as tres discordariam sobre quanto e 24x de R$ 1.000,01.
//
// `problemaDoEmprestimo` E CHAMADA AQUI, E ISSO NAO E VALIDACAO DUPLICADA
// ----------------------------------------------------------------------
// A MESMA funcao roda nos dois lados: aqui, para a pessoa ler a frase antes de
// apertar, e na rota, porque quem chega pelo PostgREST direto nao passa por
// tela nenhuma. Uma copia da regra aqui seria duplicacao; a mesma funcao nao e
// -- e e ela, e nao um `disabled` calculado a mao, que decide se o botao envia.
//
// DOIS SELETORES NATIVOS, E NAO O SELECT DO RADIX
// -----------------------------------------------
// `<select>` nativo pelo mesmo motivo que a pergunta da HMO-211 e radio nativo:
// o Radix Select monta as opcoes num PORTAL e so quando o menu abre, entao a
// assercao "o seletor lista so conta de investimento" leria uma lista vazia e
// passaria verde sobre um seletor que oferece a conta corrente. Com o select
// nativo as `<option>` estao no DOM, e a sonda as conta. O preco e conhecido: a
// aparencia e a do sistema, e nao a do resto do app.
//
// O `id` DE CADA ANCORA E PARTE DA ENTREGA
// ---------------------------------------
// `mybank-conta`, `mybank-total-emprestado`, `mybank-a-receber`,
// `mybank-juros-a-receber`, `mybank-devedor`, `mybank-erro` e os `data-*` das
// linhas sao lidos pela sonda
// de navegador. Renomear um deles sem mexer na sonda a deixa vermelha -- que e o
// comportamento certo: a ancora e um contrato, nao um detalhe de estilo.
//
// O QUE SEGURA O SEGUNDO CLIQUE E O `useRef`, E NAO O `disabled` (HMO-390)
// -----------------------------------------------------------------------
// `disabled={salvando}` continua no botao, e ele e o que a PESSOA ve -- mas ele
// nao decide nada: `setSalvando(true)` so chega ao DOM depois do re-render, e
// num toque duplo de celular os dois cliques entram em `emprestar()` antes
// disso. Quem decide e `emprestandoRef`, lido e gravado na PRIMEIRA linha da
// funcao, porque `ref.current` muda no mesmo tick.
//
// `confirmarRecebimento` tem a mesma trava, mas por PARCELA -- um `Set` de ids
// em voo, e nao um booleano. Com um booleano global, confirmar a parcela 3 e
// logo depois a 4 (duas baixas legitimas, em sequencia) perderia a segunda.
//
// O BOTAO «Cancelar» E DESTRUTIVO E MUDA A TELA DE OUTRA PESSOA (HMO-391)
// ----------------------------------------------------------------------
// Ele aparece SO em emprestimo `active`, pergunta com `confirm()` antes, e a
// pergunta vem de `avisoDoCancelamento` (que tem teste) porque ela e o unico
// lugar onde se le o que o cancelamento NAO faz: nao registra pagamento e nao
// amortiza nada. No Caso B a tela que muda e a de quem deve, e a pergunta diz
// isso pelo nome.
//
// `cancelandoRef` e a mesma trava de `parcelasEmVooRef`, por emprestimo.
//
// O GESTO «Antecipar» PERGUNTA UM NUMERO, E POR ISSO NAO E `confirm()` (HMO-397)
// -----------------------------------------------------------------------------
// Ele aparece ao lado do Cancelar, e a condicao e OUTRA: `podeAntecipar` exige
// `active` **e** parcela em aberto, porque antecipar sem nada em aberto nao tem
// o que fazer (o Cancelar fica so pelo status, de proposito -- ver lá).
//
// O dialogo e inline, com `<select>` nativo de 1 ate as em aberto, e mostra
// ANTES do clique as tres coisas que a decisao de produto promete: o valor
// total, qual passa a ser o ultimo vencimento, e que o valor das que sobram nao
// muda. A terceira e a que impede a leitura errada ("baixaram minha parcela?"),
// que e a variante REJEITADA no cartao `ae436b4a`. A frase inteira vem de
// `previaDaAntecipacao`, em `lib/`, pela mesma razao do `avisoDoCancelamento`.
//
// `antecipandoRef` e a terceira trava deste arquivo, e e a mais caro das tres: a
// rota de antecipacao NAO tem idempotencia por id (a de emprestimo tem), entao o
// segundo clique paga a cauda duas vezes -- duas pernas de entrada por parcela e
// o dobro no extrato.
//
// E A PARCELA ANTECIPADA SE DISTINGUE NA LISTA, SEM COLUNA NOVA
// ------------------------------------------------------------
// `rotuloDasParcelasAntecipadas` (`paid_date < due_date`, estado derivado -- a
// forma da HMO-366) e o que explica o `4/24` do badge ao lado de "vence
// <parcela 3>". `progressoDoEmprestimo` continua `pagas/installment_count` e
// continua certo; o que faltava era a tela dizer por que.
//
// E O LATCH NAO ALCANCA O F5: ISSO E `lib/pedido-de-emprestimo`
// ------------------------------------------------------------
// Recarregar a pagina zera todo ref e todo state. Quem viu "Emprestando..." e
// achou que travou recarrega e redigita -- e nenhuma trava de tela alcanca esse
// caminho. O que alcanca e o `id` que esta tela escolhe para o emprestimo e
// guarda em `sessionStorage` junto com a assinatura do formulario: o segundo
// POST com o mesmo id bate na chave primaria da 053 e a rota responde 200 com o
// emprestimo que ja existe. O porque de ser o par `(assinatura, id)`, e nao so o
// id, esta no cabecalho de `lib/pedido-de-emprestimo.ts`.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Landmark,
  Loader2,
  PiggyBank,
  Plus,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CampoDeValor } from "@/components/ui/campo-de-valor";
import { CampoDeData } from "@/components/ui/campo-de-data";
import { PerguntaDaBaseDoValor } from "@/components/movimentacoes/PerguntaDaBaseDoValor";
import { CamposDeJuros } from "@/components/mybank/CamposDeJuros";
import { PreviaDoEmprestimo } from "@/components/mybank/PreviaDoEmprestimo";

import { formatCurrency } from "@/lib/utils";
import { dataOuMomentoNaTela } from "@/lib/data-na-tela";
import {
  avisoDoCancelamento,
  baseQueMontaASerie,
  juroDoPedido,
  mensagemDoProblema,
  previaDaAntecipacao,
  previaDoEmprestimo,
  problemaDoEmprestimo,
  problemaDoJuroDoPedido,
  rotuloDoCampoDeValor,
  serieDoEmprestimo,
  valorQueMontaASerie,
  casoDoEmprestimo,
  modoCobraJuro,
  STATUS_CANCELADO,
  type ModoDoJuro,
  MAX_PARCELAS_DO_MYBANK,
  MIN_PARCELAS_DO_MYBANK,
  SUBTITULO_A_CONFIRMAR_NO_MYBANK,
  TITULO_A_CONFIRMAR_NO_MYBANK,
  PARCELA_FORA_DO_REALIZADO,
} from "@/lib/emprestimo-do-mybank";
import {
  parcelaDigitada,
  resumoDaSerie,
  type BaseDoValorParcelado,
} from "@/lib/lancamento";
import {
  assinaturaDoPedido,
  idDoPedido,
  lerPedidoGuardado,
  CHAVE_DO_PEDIDO,
} from "@/lib/pedido-de-emprestimo";
import {
  conexoesParaEmprestar,
  contasQueEmprestam,
  contasQuePagamAParcela,
  devedorTemConexaoAceita,
  emprestimoEncerrado,
  linhasAReceber,
  podeAntecipar,
  previaDaAntecipacaoNaTela,
  progressoDoEmprestimo,
  proximoVencimento,
  quantasEmAbertoNoEmprestimo,
  recorteDaListaDeEmprestimos,
  rotuloDaContaCredora,
  rotuloDasParcelasAntecipadas,
  rotuloDoStatusDoEmprestimo,
  totaisDaContaCredora,
  valorDaParcelaNaLista,
  type ConexaoCrua,
  type ContaNaTelaDoMyBank,
  type EmprestimoDoMyBank,
} from "@/lib/mybank-na-tela";
import {
  fraseDoEmprestadoNoAjuste,
  parcelasParaAjustar,
  pedidoAjustaAlgumCampo,
  pedidoDoAjusteDaTela,
  previaDoAjuste,
  rotuloDoModoDoAjuste,
  FORMULARIO_DO_AJUSTE_VAZIO,
  type FormularioDoAjuste,
} from "@/lib/ajuste-do-emprestimo-na-tela";

/** "eu mesmo" ou "uma conexao" -- o radio que a issue pede. */
type QuemPaga = "eu" | "conexao";

const PARCELAS_PADRAO = "12";

export function PainelDoMyBank({ meuId }: { meuId: string }) {
  const [contas, setContas] = useState<ContaNaTelaDoMyBank[]>([]);
  const [emprestimos, setEmprestimos] = useState<EmprestimoDoMyBank[]>([]);
  const [conexoes, setConexoes] = useState<ConexaoCrua[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [contaEscolhida, setContaEscolhida] = useState<string | null>(null);

  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [base, setBase] = useState<BaseDoValorParcelado>("parcela");

  // OS JUROS (HMO-448). `sem_juros` e o padrao, e o padrao importa: ele e o
  // caminho que ja existia, e abrir o formulario cobrando juro mudaria o
  // significado do campo de valor para quem so queria emprestar.
  const [modoDoJuro, setModoDoJuro] = useState<ModoDoJuro>("sem_juros");
  /** A taxa em PERCENTO, como foi digitada ("20"). Ver `juroDoPedido`. */
  const [taxaDoJuro, setTaxaDoJuro] = useState("");
  /** O total a receber, plano em reais ("1200.00"). */
  const [totalDoJuro, setTotalDoJuro] = useState("");
  const [parcelas, setParcelas] = useState(PARCELAS_PADRAO);
  const [primeiroVencimento, setPrimeiroVencimento] = useState("");
  const [quemPaga, setQuemPaga] = useState<QuemPaga>("eu");
  const [devedorId, setDevedorId] = useState<string | null>(null);
  const [contaDePagamentoId, setContaDePagamentoId] = useState<string | null>(
    null
  );
  const [erro, setErro] = useState<string | null>(null);

  /**
   * A TRAVA DO ENVIO, E ELA E `useRef` E NAO `useState` DE PROPOSITO.
   *
   * `salvando` (acima) e o que a tela MOSTRA; este ref e o que DECIDE. A
   * diferenca e o tick: `setSalvando(true)` agenda um re-render, e o
   * `disabled={salvando}` do botao so chega ao DOM depois dele -- dois cliques
   * no mesmo tick (o toque duplo de celular) passam os dois. `ref.current = true`
   * vale na linha seguinte, para o clique seguinte, sem render nenhum no meio.
   *
   * Trocar este `useRef` por `useState` deixa a tela com a MESMA aparencia e
   * volta a criar duas dividas: e um dos mutantes de
   * `scripts/mutantes-latch-do-mybank.mjs`.
   */
  const emprestandoRef = useRef(false);

  /**
   * AS PARCELAS EM VOO -- UM `Set` DE ids, E NAO UM BOOLEANO.
   *
   * Um booleano global aqui seria uma regressao de produto: confirmar a parcela
   * 3 e logo depois a 4 sao duas baixas legitimas em sequencia, e com um
   * booleano a segunda cairia calada enquanto a primeira estivesse em voo. O que
   * nao pode repetir e a MESMA parcela -- entao a trava e por id.
   */
  const parcelasEmVooRef = useRef<Set<string>>(new Set());

  /**
   * OS CANCELAMENTOS EM VOO -- um `Set` de ids de EMPRESTIMO.
   *
   * A mesma forma de `parcelasEmVooRef`, e por `useRef` pela mesma razao do
   * `emprestandoRef`: o `disabled` so chega ao DOM depois do re-render, e dois
   * toques na mesma linha mandariam dois PATCH. Aqui o segundo nao duplica
   * dinheiro -- ele cai no 409 de "ja cancelado" --, mas mostra um toast de erro
   * logo depois do toast de sucesso, sobre uma operacao que deu certo.
   *
   * Por emprestimo, e nao um booleano global: cancelar duas dividas erradas em
   * sequencia e legitimo, e um booleano perderia a segunda.
   */
  const cancelandoRef = useRef<Set<string>>(new Set());

  /**
   * QUAL EMPRESTIMO TEM O DIALOGO DE ANTECIPAR ABERTO (HMO-397). `null` = nenhum.
   *
   * UM SO, e nao um `Set`: o dialogo pergunta "quantas parcelas" e mostra o valor
   * total daquela serie. Dois abertos ao mesmo tempo teriam duas previas na tela
   * e um unico campo de quantidade -- a pessoa leria o valor de um emprestimo com
   * a quantidade do outro. Abrir o segundo fecha o primeiro, por construcao.
   */
  const [antecipando, setAntecipando] = useState<string | null>(null);

  /** Quantas parcelas o dialogo esta pedindo. String porque e o valor do `<select>`. */
  const [quantasParaAntecipar, setQuantasParaAntecipar] = useState("1");

  /**
   * AS ANTECIPACOES EM VOO -- o `Set` que o `disabled` MOSTRA.
   *
   * Ele e `useState` de proposito, e nao e ele que decide: ver `antecipandoRef`,
   * logo abaixo. O que ele faz e deixar o botao desabilitado DEPOIS do
   * re-render, que e o que a pessoa ve -- e o que da ao caso do latch uma medida
   * honesta: a sonda le o `disabled` no instante do segundo clique e afirma que
   * ele ainda era `false`, provando que quem segurou o POST foi o ref.
   */
  const [antecipacoesEmVoo, setAntecipacoesEmVoo] = useState<string[]>([]);

  /**
   * A TRAVA DA ANTECIPACAO -- `useRef`, e por emprestimo.
   *
   * `useRef` pela razao do `emprestandoRef`: `setAntecipacoesEmVoo` agenda um
   * re-render, e o `disabled` so chega ao DOM depois dele -- os dois cliques de
   * um toque duplo entram no handler antes disso. E aqui o custo do segundo
   * clique e DINHEIRO: a rota de antecipacao nao tem idempotencia por id (o POST
   * de emprestimo tem; este nao), entao dois POST pagam a cauda DUAS vezes --
   * duas pernas de entrada por parcela, o dobro do valor no extrato, e parcelas
   * que ja estavam `paid` sendo pagas de novo mais acima na serie.
   *
   * Por emprestimo e nao um booleano global, como `cancelandoRef`: antecipar em
   * duas dividas diferentes em sequencia e legitimo.
   */
  const antecipandoRef = useRef<Set<string>>(new Set());

  /**
   * QUAL EMPRESTIMO TEM O DIALOGO DE AJUSTAR ABERTO (HMO-480).
   *
   * UM SO, pela razao de `antecipando` logo acima, e aqui ela e mais forte: o
   * formulario do ajuste e UM (`formularioDoAjuste`), com descricao, taxa e
   * data. Dois dialogos abertos mostrariam duas previas alimentadas pelos
   * MESMOS campos, e o clique em "Ajustar" de um renomearia a divida com o
   * texto digitado pensando no outro.
   */
  const [ajustando, setAjustando] = useState<string | null>(null);

  /**
   * O que os campos do ajuste tem AGORA -- vazio quer dizer "nao toquei".
   *
   * Um objeto so e nao cinco `useState`: a regra "abrir o dialogo zera tudo" e
   * sobre o conjunto, e cinco setters num `abrirAjuste` sao cinco lugares de
   * onde esquecer um campo. `FORMULARIO_DO_AJUSTE_VAZIO` e a mesma constante que
   * a suite usa como ponto de partida, entao o que a tela abre e o que o teste
   * mede. Ver A PRESENCA DO CAMPO MANDA em `lib/ajuste-do-emprestimo-na-tela.ts`.
   */
  const [formularioDoAjuste, setFormularioDoAjuste] =
    useState<FormularioDoAjuste>(FORMULARIO_DO_AJUSTE_VAZIO);

  /** Os ajustes em voo -- o `Set` que o `disabled` MOSTRA. A forma de `antecipacoesEmVoo`. */
  const [ajustesEmVoo, setAjustesEmVoo] = useState<string[]>([]);

  /**
   * A TRAVA DO AJUSTE -- `useRef`, e por emprestimo.
   *
   * A mesma forma de `antecipandoRef`, e o segundo clique custa dinheiro aqui
   * tambem: o PATCH de ajuste nao tem idempotencia por id, e ele REESCREVE o
   * valor das pendentes. Dois pedidos iguais em sequencia sao inocuos por
   * coincidencia (a cauda e recalculada do total, nao incrementada), mas dois
   * pedidos em voo ao mesmo tempo leem a mesma serie e escrevem em cima um do
   * outro -- e o segundo le `jaRecebido` de antes do primeiro.
   */
  const ajustandoRef = useRef<Set<string>>(new Set());

  /**
   * A SECAO DOS ENCERRADOS ESTA ABERTA? (HMO-398). Fechada por padrao.
   *
   * O recorte em si e de `recorteDaListaDeEmprestimos`, em `lib/`; aqui mora so
   * o estado do botao. Fechada por padrao porque cada divida encerrada fica na
   * lista PARA SEMPRE -- `mybank_loans_delete` recusa emprestimo com parcela
   * `paid` de proposito --, e a F2 da HMO-393 produz um `settled` por
   * antecipacao total.
   */
  const [encerradosAbertos, setEncerradosAbertos] = useState(false);

  const carregar = useCallback(async () => {
    try {
      // AS TRES LEITURAS EM PARALELO, e cada uma com `ok` conferido.
      //
      // `response.json()` de um 500 deste app devolve `{ error: "..." }`, que e
      // um objeto perfeitamente valido -- e `dados.accounts ?? []` o lê como
      // "nenhuma conta". A tela abriria dizendo "cadastre uma conta de
      // investimento" para quem tem seis. E o `export-de-relatorio-nunca-
      // confere-error-nos-cinco` deste repositorio, no outro sentido.
      const [respContas, respEmprestimos, respConexoes] = await Promise.all([
        fetch("/api/financial-accounts"),
        fetch("/api/mybank/loans"),
        fetch("/api/connections"),
      ]);

      if (respContas.ok) {
        const dados = await respContas.json();
        setContas(dados.accounts ?? []);
      }

      if (respEmprestimos.ok) {
        const dados = await respEmprestimos.json();
        setEmprestimos(dados.loans ?? []);
      }

      if (respConexoes.ok) {
        const dados = await respConexoes.json();
        // `/api/connections` devolve a LISTA nua, nao `{ connections: [...] }`
        // -- as duas formas existem no app (`/api/personal-finance/connections`
        // e a outra), e trocar uma pela outra deixaria o seletor vazio sem erro
        // nenhum.
        setConexoes(Array.isArray(dados) ? dados : []);
      }
    } catch (e) {
      console.error("Erro ao carregar o MyBank:", e);
      toast.error("Não foi possível carregar o MyBank.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const contasCredoras = useMemo(() => contasQueEmprestam(contas), [contas]);

  // A PRIMEIRA CONTA DE INVESTIMENTO VIRA A ESCOLHIDA, uma vez.
  //
  // `contaEscolhida === null` na guarda e nao um `!contaEscolhida`: id vazio nao
  // existe, e a diferenca importa no dia em que a pessoa trocar de conta e a
  // lista for recarregada -- sem a guarda o seletor voltaria sozinho para a
  // primeira, desfazendo a escolha de quem olha.
  useEffect(() => {
    if (contaEscolhida === null && contasCredoras.length > 0) {
      setContaEscolhida(contasCredoras[0].id);
    }
  }, [contaEscolhida, contasCredoras]);

  const contasPagadoras = useMemo(
    () => contasQuePagamAParcela(contas, contaEscolhida),
    [contas, contaEscolhida]
  );

  const devedoresPossiveis = useMemo(
    () => conexoesParaEmprestar(conexoes, meuId),
    [conexoes, meuId]
  );

  const doEscolhido = useMemo(
    () =>
      contaEscolhida === null
        ? []
        : emprestimos.filter((e) => e.conta_credora_id === contaEscolhida),
    [emprestimos, contaEscolhida]
  );

  /**
   * O RECORTE DA LISTA (HMO-398) -- os em andamento em cima, os encerrados atras
   * de um botao. A decisao esta em `lib/mybank-na-tela`, nao aqui: um `useMemo`
   * com o filtro escrito dentro dele nao tem suite que o alcance, e e por isso
   * que `totaisDaContaCredora` tambem mora lá.
   */
  const recorteDaLista = useMemo(
    () => recorteDaListaDeEmprestimos(doEscolhido, encerradosAbertos),
    [doEscolhido, encerradosAbertos]
  );

  const totais = useMemo(
    () => totaisDaContaCredora(emprestimos, contaEscolhida),
    [emprestimos, contaEscolhida]
  );

  const aReceber = useMemo(() => linhasAReceber(doEscolhido), [doEscolhido]);

  const aConfirmar = useMemo(
    () => aReceber.filter((linha) => linha.aConfirmar),
    [aReceber]
  );

  const numeroDeParcelas = parcelaDigitada(parcelas);

  /**
   * O JURO RESOLVIDO, pela MESMA funcao que a rota chama.
   *
   * Nao ha `if` de dois sentidos aqui: `juroDoPedido` recebe o modo e os campos
   * crus e devolve as quatro grandezas, ou `null`. Dois `if` na tela e dois na
   * rota divergiriam na primeira mudanca, e o sintoma seria a previa mostrando
   * um total que o banco nao grava.
   */
  const juro = useMemo(
    () =>
      juroDoPedido({
        modo: modoDoJuro,
        emprestado: valor,
        taxaPercentual: taxaDoJuro,
        totalARceber: totalDoJuro,
      }),
    [modoDoJuro, valor, taxaDoJuro, totalDoJuro]
  );

  // A SERIE E MONTADA SOBRE O TOTAL QUANDO HA JURO -- o mesmo par de funcoes que
  // a rota usa. E o ponto exato onde o dinheiro muda de valor, e tela e rota
  // chegam nele pelo MESMO caminho de propósito: se a tela montasse a serie
  // sobre o principal, a previa mostraria parcelas menores do que as que vao
  // ser gravadas, e a conferencia antes do clique deixaria de valer.
  const serie = useMemo(
    () =>
      serieDoEmprestimo({
        valor: valorQueMontaASerie({ modo: modoDoJuro, digitado: valor, juro }),
        base: baseQueMontaASerie({ modo: modoDoJuro, daTela: base }) as
          BaseDoValorParcelado,
        parcelas: numeroDeParcelas,
        primeiroVencimento,
      }),
    [modoDoJuro, valor, juro, base, numeroDeParcelas, primeiroVencimento]
  );

  const resumo = resumoDaSerie(serie);

  /** AS QUATRO GRANDEZAS, SEMPRE -- o que a issue pede ver antes do clique. */
  const previa = useMemo(
    () => previaDoEmprestimo({ modo: modoDoJuro, juro, serie }),
    [modoDoJuro, juro, serie]
  );

  const devedorDoPedido = quemPaga === "conexao" ? devedorId : meuId;

  /**
   * O CASO, e o `null` tratado EXPLICITAMENTE.
   *
   * `devedorId` e `null` enquanto ninguem foi escolhido no seletor. Um
   * `?? meuId` aqui faria o pedido virar AUTO-EMPRESTIMO -- e a recusa sairia
   * como "escolha a conta de onde as parcelas saem", uma frase sobre um campo
   * que este ramo da tela nao tem. Quem marcou "uma conexao" e nao escolheu a
   * pessoa precisa ler que falta a pessoa, e e `devedor_sem_conexao` que diz
   * isso.
   *
   * Foi a sonda de navegador que achou isto: o caso B media a recusa e recebia
   * a frase da conta de pagamento. Com `?? meuId` nada compilava errado, nada
   * respondia 500, e a tela recusava com a razao errada.
   */
  const caso =
    devedorDoPedido === null
      ? "conexao"
      : casoDoEmprestimo({
          lenderUserId: meuId,
          borrowerUserId: devedorDoPedido,
        });

  /**
   * O PROBLEMA DO PEDIDO, pela MESMA funcao que a rota chama.
   *
   * `conexaoAceita` sai de `devedorTemConexaoAceita` sobre a lista JA FILTRADA
   * por `status === "accepted"`: se o nome nao esta entre as opcoes, ele nao e
   * aceito, por construcao. Perguntar a lista crua aqui deixaria a tela aceitar
   * um pedido que a trigger da 053 recusa.
   */
  const problema = problemaDoEmprestimo({
    descricao,
    // A BASE EFETIVA: com juro ela e `total` cravado e a pergunta
    // `parcela|total` nem e desenhada. Ver `baseQueMontaASerie`.
    base: baseQueMontaASerie({ modo: modoDoJuro, daTela: base }),
    caso,
    contaCredoraPedida: contaEscolhida,
    contaCredora: contasCredoras.find((c) => c.id === contaEscolhida) ?? null,
    contaDePagamentoPedida: quemPaga === "eu" ? contaDePagamentoId : null,
    contaDePagamento:
      quemPaga === "eu"
        ? contasPagadoras.find((c) => c.id === contaDePagamentoId) ?? null
        : null,
    conexaoAceita:
      quemPaga === "conexao"
        ? devedorTemConexaoAceita(devedoresPossiveis, devedorId)
        : false,
    problemaDoJuro: problemaDoJuroDoPedido({
      modo: modoDoJuro,
      emprestado: valor,
      taxaPercentual: taxaDoJuro,
      totalARceber: totalDoJuro,
    }),
    parcelas: numeroDeParcelas,
    serie,
  });

  async function emprestar() {
    // A TRAVA, NA PRIMEIRA LINHA, E ANTES DE QUALQUER `await`.
    //
    // Entre o `if` e a atribuicao nao ha ponto de suspensao nenhum, entao o
    // segundo clique do mesmo tick ve `true` e sai. Qualquer linha de trabalho
    // acima desta -- inclusive a leitura do `problema` -- reabriria a janela que
    // esta trava existe para fechar.
    if (emprestandoRef.current) return;
    emprestandoRef.current = true;

    try {
      // A RECUSA SAI DA FUNCAO PURA, e a frase tambem.
      //
      // Nao ha um segundo criterio aqui ("se faltar descricao, diga X"): a
      // mensagem e `mensagemDoProblema`, a mesma que a rota devolve no 400. Duas
      // frases para o mesmo motivo fariam a tela e a API discordarem sobre o que
      // esta errado.
      //
      // Ela esta DENTRO do `try` por causa do `finally`: antes da trava este
      // `return` era so uma saida, e agora ele tem de liberar o ref -- senao
      // um pedido incompleto tranca o botao para sempre, e a unica saida da
      // pessoa seria recarregar.
      if (problema) {
        setErro(mensagemDoProblema(problema));
        return;
      }

      setErro(null);
      setSalvando(true);

      // O id DESTE PEDIDO (HMO-390).
      //
      // `sessionStorage` dentro de `try/catch` proprio: navegador em modo
      // restrito pode LANCAR no `getItem`, e um throw aqui derrubaria o
      // emprestimo inteiro por causa do armazenamento. Sem o par guardado a
      // feature degrada para "um id novo por envio" -- que e o comportamento de
      // antes desta issue, e nao um erro para a pessoa ler.
      const assinatura = assinaturaDoPedido({
        descricao,
        contaCredoraId: contaEscolhida,
        contaDePagamentoId: quemPaga === "eu" ? contaDePagamentoId : null,
        devedorId: quemPaga === "conexao" ? devedorId : null,
        valor,
        base,
        parcelas,
        primeiroVencimento,
      });

      let guardado = null;
      try {
        guardado = lerPedidoGuardado(sessionStorage.getItem(CHAVE_DO_PEDIDO));
      } catch {
        guardado = null;
      }

      const pedido = idDoPedido({
        guardado,
        assinatura,
        novoId: crypto.randomUUID(),
      });

      try {
        sessionStorage.setItem(
          CHAVE_DO_PEDIDO,
          JSON.stringify(pedido.aGuardar)
        );
      } catch {
        // Ver acima: sem armazenamento a feature degrada, nao falha.
      }

      const resposta = await fetch("/api/mybank/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // O id DO EMPRESTIMO, ESCOLHIDO AQUI (HMO-390).
          //
          // A coluna tem `DEFAULT gen_random_uuid()`, entao mandar o id nao e
          // obrigatorio -- e e por isso que ele funciona como chave de pedido:
          // a rota insere ESTE id, a PK recusa o segundo com `23505`, e o
          // recarregar-e-reenviar deixa de criar a segunda divida.
          id: pedido.id,
          descricao,
          conta_credora_id: contaEscolhida,
          // `null` EXPLICITO no Caso B: a rota so exige conta de pagamento no
          // auto-emprestimo, e mandar uma aqui faria `previsoesDoEmprestimo`
          // ter as duas guardas satisfeitas -- 24 contas a pagar no meu nome
          // por um dinheiro que a outra pessoa paga.
          conta_de_pagamento_id: quemPaga === "eu" ? contaDePagamentoId : null,
          // Ausente quer dizer "eu mesmo"; a rota traduz para o meu id.
          devedor_id: quemPaga === "conexao" ? devedorId : null,
          // O VALOR VAI CRU, COM A BASE AO LADO (HMO-211): quem faz a conta e o
          // servidor, com a mesma funcao pura que montou o resumo acima.
          valor,
          base,
          parcelas: numeroDeParcelas,
          primeiro_vencimento: primeiroVencimento,
          // OS JUROS VAO CRUS, COM O MODO AO LADO (HMO-448), pela mesma razao
          // do `valor`/`base` acima: quem faz a conta e o SERVIDOR, com a mesma
          // funcao pura que montou a previa. Mandar o total ja calculado poria
          // a aritmetica do dinheiro no cliente -- e a rota gravaria um total
          // que ela nao teve como conferir.
          modo_do_juro: modoDoJuro,
          taxa: taxaDoJuro,
          total: totalDoJuro,
        }),
      });

      const dados = await resposta.json();

      if (!resposta.ok) {
        // O 409 ESQUECE O PEDIDO, E SEM ISSO O "tente de novo" E MENTIRA.
        //
        // 409 quer dizer "o id que você escolheu é de uma linha que não é sua"
        // (ver o bloco do `23505` na rota). O par guardado continuaria casando
        // com este formulário, então o reenvio mandaria o MESMO id, colidiria
        // com a MESMA linha e voltaria 409 -- para sempre. A pessoa leria
        // "tente de novo" num botão que nunca mais funciona.
        //
        // Nos OUTROS erros o par FICA de propósito: é justamente ali que ele
        // serve (a rede que caiu, o 500 do meio do caminho), e é o que faz o
        // reenvio depois do F5 não criar a segunda dívida.
        if (resposta.status === 409) {
          try {
            sessionStorage.removeItem(CHAVE_DO_PEDIDO);
          } catch {
            // Armazenamento indisponivel nao e erro de pessoa -- e sem o par
            // guardado o proximo envio ja sorteia um id novo, que e exatamente
            // o que este ramo quer.
          }
        }

        setErro(dados.error ?? "Não foi possível criar o empréstimo.");
        return;
      }

      // A MENSAGEM E A DA ROTA, e ela diz ONDE a parcela vai aparecer.
      //
      // Os dois casos tem destinos diferentes (Contas a Pagar no A, so o MyBank
      // no B), e um texto escrito aqui faria o Caso B parecer que criou conta a
      // pagar no meu nome -- que e exatamente o que ele nao faz.
      toast.success(dados.message ?? "Empréstimo criado.");

      // O PEDIDO E ESQUECIDO SO NO SUCESSO, e isso e o que libera o PROXIMO
      // emprestimo igual.
      //
      // Emprestar de novo o mesmo valor para a mesma pessoa no mesmo dia e um
      // pedido legitimo; sem este `removeItem` ele reaproveitaria o id do
      // anterior e voltaria 200 com uma divida que ja existia, sem gravar nada.
      // No caminho de ERRO o par FICA -- e justamente ali que ele serve.
      try {
        sessionStorage.removeItem(CHAVE_DO_PEDIDO);
      } catch {
        // Ver a leitura, acima: armazenamento indisponivel nao e erro de pessoa.
      }

      setDescricao("");
      setValor("");
      setParcelas(PARCELAS_PADRAO);
      setPrimeiroVencimento("");
      // OS CAMPOS DO JURO LIMPAM JUNTO, E O MODO VOLTA PARA `sem_juros`.
      //
      // Sem isto o proximo emprestimo nasceria com a taxa do anterior ja
      // preenchida e o modo ainda em "% de juros": quem acabou de emprestar a
      // 20% e vai emprestar outra coisa a juro zero clicaria em Emprestar com
      // um juro que ele nao digitou desta vez -- e a previa mostraria o numero
      // certo para um pedido que a pessoa nao esta lendo, porque ela acabou de
      // limpar o resto do formulario com os olhos.
      setModoDoJuro("sem_juros");
      setTaxaDoJuro("");
      setTotalDoJuro("");
      await carregar();
    } catch (e) {
      console.error("Erro ao criar o emprestimo:", e);
      setErro("Não foi possível criar o empréstimo.");
    } finally {
      // A TRAVA E LIBERADA AQUI, E NAO NO FIM DO CAMINHO FELIZ.
      //
      // `finally` cobre as tres saidas (o `problema`, o `!resposta.ok` e o
      // throw de rede). Liberar depois do `carregar()` deixaria o botao preso
      // em todo caminho de erro.
      emprestandoRef.current = false;
      setSalvando(false);
    }
  }

  async function confirmarRecebimento(parcelaId: string) {
    // A TRAVA POR PARCELA, NA PRIMEIRA LINHA.
    //
    // `has`/`add` no mesmo tick, pelo mesmo motivo do `emprestandoRef`: aqui nao
    // havia guarda NENHUMA antes da HMO-390 -- nem `disabled` --, entao dois
    // toques na mesma linha mandavam duas baixas da mesma parcela.
    //
    // O `Set` e o que mantem as parcelas INDEPENDENTES: `linha.id` e a chave, e
    // confirmar a 3 nao tranca a 4.
    if (parcelasEmVooRef.current.has(parcelaId)) return;
    parcelasEmVooRef.current.add(parcelaId);

    try {
      const resposta = await fetch(`/api/mybank/installments/${parcelaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid" }),
      });

      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível confirmar.");
        return;
      }

      toast.success(dados.message ?? "Parcela baixada.");
      await carregar();
    } catch (e) {
      console.error("Erro ao confirmar a parcela:", e);
      toast.error("Não foi possível confirmar.");
    } finally {
      // A parcela SAI do conjunto, nos tres caminhos.
      //
      // Sem o `delete` a trava viraria permanente: a baixa que falhou por rede
      // nao teria segunda tentativa, e o botao continuaria clicavel (ele nao
      // tem `disabled`) sem nunca mais chamar a rota -- um clique que nao faz
      // nada e nao diz nada, que e pior que o erro.
      parcelasEmVooRef.current.delete(parcelaId);
    }
  }

  /**
   * Cancelar o emprestimo -- a acao destrutiva desta tela (HMO-391).
   *
   * A PERGUNTA E `confirm()`, E ISSO E A CONVENCAO MEDIVEL DESTE REPOSITORIO
   * ----------------------------------------------------------------------
   * O mesmo caminho de `ListaDeMovimentacao`: a sonda substitui
   * `window.confirm`, LE a frase que o app passou e afirma sobre ela. Com um
   * dialogo de componente o que estaria provado seria o texto do esboco -- e
   * aqui o TEXTO e parte da entrega, porque ele e o unico lugar onde a pessoa
   * le que cancelar nao e pagar.
   *
   * O texto vem de `avisoDoCancelamento`, que tem teste. Escrito aqui, ele
   * passaria por qualquer suite intacto.
   */
  async function cancelarEmprestimo(emprestimo: EmprestimoDoMyBank) {
    // A TRAVA POR EMPRESTIMO, NA PRIMEIRA LINHA -- antes do `confirm()`.
    //
    // Antes da pergunta e nao depois: `confirm()` e bloqueante, mas o clique
    // que chega enquanto o PATCH esta em voo (a pergunta ja respondida) abriria
    // uma SEGUNDA pergunta sobre uma divida que esta sendo encerrada.
    if (cancelandoRef.current.has(emprestimo.id)) return;

    if (
      !confirm(
        avisoDoCancelamento({
          descricao: emprestimo.descricao,
          caso: emprestimo.caso,
          // `quem_deve_pagar` JA e o nome resolvido pela rota (`quemDevePagar`),
          // inclusive a frase de contato indisponivel. No Caso A ele e "Você
          // mesmo", e a frase do aviso nao usa nome nenhum ali.
          nomeDoDevedor:
            emprestimo.caso === "conexao" ? emprestimo.quem_deve_pagar : null,
        })
      )
    ) {
      return;
    }

    cancelandoRef.current.add(emprestimo.id);

    try {
      const resposta = await fetch(`/api/mybank/loans/${emprestimo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: STATUS_CANCELADO }),
      });

      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível cancelar o empréstimo.");
        return;
      }

      // A MENSAGEM DA ROTA, e nao uma frase daqui: e ela que diz quantas
      // parcelas foram canceladas, quantas pagas ficaram e o que saiu da agenda
      // -- numeros que so o servidor tem depois de escrever.
      toast.success(dados.message ?? "Empréstimo cancelado.");
      await carregar();
    } catch (e) {
      console.error("Erro ao cancelar o emprestimo:", e);
      toast.error("Não foi possível cancelar o empréstimo.");
    } finally {
      cancelandoRef.current.delete(emprestimo.id);
    }
  }

  /**
   * ABRIR O DIALOGO DE ANTECIPAR (HMO-397).
   *
   * A QUANTIDADE VOLTA PARA 1 A CADA ABERTURA, e isso nao e arrumacao: sem o
   * reset, abrir o dialogo de um emprestimo com 6 parcelas em aberto depois de
   * ter escolhido 12 em outro deixaria o `<select>` com um valor que nao esta
   * entre as opcoes -- o navegador mostraria a primeira opcao e o estado
   * continuaria 12, entao a previa diria "12 parcelas" e o POST mandaria 12 numa
   * serie que tem 6. O `value` do `<select>` e o estado, nao o contrario.
   */
  function abrirAntecipacao(emprestimo: EmprestimoDoMyBank) {
    setQuantasParaAntecipar("1");
    setAntecipando(emprestimo.id);
  }

  /**
   * Antecipar -- a operacao que move dinheiro ANTES do vencimento (HMO-397).
   *
   * NAO HA `confirm()` AQUI, E A DIFERENCA COM O CANCELAR E DE CONTEUDO
   * ------------------------------------------------------------------
   * O cancelamento e um gesto de UM clique sobre uma decisao binaria, e por isso
   * a pergunta nativa serve: o texto de `avisoDoCancelamento` e tudo o que falta
   * dizer. A antecipacao PEDE UM NUMERO, e o valor total muda com ele -- um
   * `confirm()` teria de ser montado depois de a pessoa escolher, em outro lugar
   * da tela, e o numero que ela leria seria o de antes da escolha. O dialogo
   * mostra a previa AO LADO do campo, e ela se refaz a cada troca.
   *
   * O que o `confirm()` garantia continua garantido pelo mesmo caminho de
   * sempre: o texto vem de `previaDaAntecipacao`, em `lib/`, e tem suite propria
   * -- escrito aqui ele passaria por qualquer uma delas intacto.
   */
  async function antecipar(emprestimo: EmprestimoDoMyBank) {
    // A TRAVA POR EMPRESTIMO, NA PRIMEIRA LINHA -- `has`/`add` no mesmo tick.
    //
    // Antes de qualquer `await` e antes de qualquer `setState`: e o unico lugar
    // onde ela pega o segundo clique de um toque duplo (ver `antecipandoRef`).
    if (antecipandoRef.current.has(emprestimo.id)) return;
    antecipandoRef.current.add(emprestimo.id);
    setAntecipacoesEmVoo((voando) => [...voando, emprestimo.id]);

    // `Number(...)` do valor do `<select>`, e as opcoes dele sao 1..em aberto --
    // entao `mais_do_que_em_aberto` nao e alcancavel pela tela. A rota continua
    // perguntando, porque quem chega pelo PostgREST nao passa por tela nenhuma.
    const quantas = Number(quantasParaAntecipar);

    try {
      const resposta = await fetch(
        `/api/mybank/loans/${emprestimo.id}/antecipacao`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parcelas: quantas }),
        }
      );

      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível antecipar as parcelas.");
        return;
      }

      // A MENSAGEM DA ROTA, e nao uma frase daqui: e ela que diz quantas
      // parcelas DE VERDADE entraram (o laco pode ter parado no meio), qual
      // passou a ser o ultimo vencimento e se o emprestimo quitou -- numeros que
      // so o servidor tem depois de escrever.
      //
      // `success: false` na antecipacao PARCIAL vem como sucesso aqui de
      // proposito: 1 de 2 antecipada e dinheiro que se moveu e parcela que ficou
      // paga, e um toast de ERRO sobre isso faria a pessoa tentar de novo e
      // antecipar uma terceira. A mensagem da rota diz o numero.
      toast.success(dados.message ?? "Parcelas antecipadas.");
      setAntecipando(null);
      await carregar();
    } catch (e) {
      console.error("Erro ao antecipar as parcelas:", e);
      toast.error("Não foi possível antecipar as parcelas.");
    } finally {
      // A TRAVA E LIBERADA NOS TRES CAMINHOS. Sem o `delete`, a antecipacao que
      // falhou por rede nao teria segunda tentativa: o botao voltaria a ficar
      // habilitado (o `disabled` sai do estado) e nao chamaria rota nenhuma.
      antecipandoRef.current.delete(emprestimo.id);
      setAntecipacoesEmVoo((voando) =>
        voando.filter((id) => id !== emprestimo.id)
      );
    }
  }

  /**
   * ABRIR O DIALOGO DE AJUSTAR (HMO-480).
   *
   * OS CAMPOS NASCEM VAZIOS, E NAO COM OS VALORES DE HOJE
   * ----------------------------------------------------
   * E a regra inteira desta feature, e ela parece hostil ate se ler o porque:
   * um campo pre-preenchido viaja no corpo do PATCH, e `{descricao: "Geladeira"}`
   * sobre um emprestimo que JA se chama "Geladeira" nao e inocuo -- e um ajuste,
   * que grava, e que a frase da rota reporta. Preencher os quatro faria todo
   * conserto de typo recalcular a serie inteira.
   *
   * O reset na ABERTURA e nao no fechamento, pela razao de `abrirAntecipacao`:
   * o estado e um so para todos os emprestimos da lista, e um campo deixado
   * preenchido ao fechar o dialogo do A apareceria no do B -- ali um clique em
   * "Ajustar" renomearia a divida errada com um texto que a pessoa nem ve, porque
   * ela abriu o dialogo achando que ele estava limpo.
   */
  function abrirAjuste(emprestimo: EmprestimoDoMyBank) {
    setFormularioDoAjuste(FORMULARIO_DO_AJUSTE_VAZIO);
    setAjustando(emprestimo.id);
  }

  /**
   * AJUSTAR -- o PATCH que a F4 e a F7 entregaram e que nenhuma tela chamava.
   *
   * O CORPO SAI DE `pedidoDoAjusteDaTela`, E NAO DE UM LITERAL AQUI
   * --------------------------------------------------------------
   * A decisao de qual campo viaja e a feature (ver A PRESENCA DO CAMPO MANDA em
   * `lib/ajuste-do-emprestimo-na-tela.ts`), e escrita neste handler ela passaria por qualquer
   * suite intacta -- a sonda de navegador LE o corpo que este `fetch` montou, e
   * a suite mede a mesma funcao sem navegador.
   *
   * AS RECUSAS SAO AS DA ROTA, as 12 de `mensagemDoProblemaDoAjuste`. O
   * `toast.error(dados.error)` e o mesmo do cancelar e do antecipar, e e o certo:
   * aquelas frases tem NUMERO que so o servidor sabe depois de ler a serie
   * ("já foram recebidos R$ 600,00", "a parcela 3/24 está avisada"). Reescritas
   * aqui, a tela mostraria uma frase e o banco teria outro motivo.
   *
   * DUAS DELAS A TELA JA TORNA INALCANCAVEIS, e e por construcao e nao por
   * validacao: `nada_a_ajustar` (o botao se desabilita sem campo tocado) e
   * `taxa_e_total_juntos` (o alternador monta um campo so). A rota continua
   * perguntando pelas duas, porque quem chega pelo PostgREST nao passa por tela.
   */
  async function ajustarEmprestimo(emprestimo: EmprestimoDoMyBank) {
    // A TRAVA POR EMPRESTIMO, NA PRIMEIRA LINHA -- `has`/`add` no mesmo tick,
    // antes de qualquer `await` e de qualquer `setState`. Ver `ajustandoRef`.
    if (ajustandoRef.current.has(emprestimo.id)) return;
    ajustandoRef.current.add(emprestimo.id);
    setAjustesEmVoo((voando) => [...voando, emprestimo.id]);

    const pedido = pedidoDoAjusteDaTela(formularioDoAjuste);

    try {
      const resposta = await fetch(`/api/mybank/loans/${emprestimo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // SEM `status` NO CORPO, e e isso que faz a rota despachar para o
        // ajuste: `status` presente e um pedido de CANCELAR (e o unico valor
        // que ela aceita ali e `cancelled`). Mandar `status: emprestimo.status`
        // "para completar o corpo" cairia na recusa de status, nao no ajuste.
        body: JSON.stringify(pedido),
      });

      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível ajustar o empréstimo.");
        return;
      }

      // A MENSAGEM DA ROTA, e nao uma frase daqui: e ela que diz quantas
      // parcelas da cauda foram reescritas, qual passou a ser o total e quanto
      // ja havia sido recebido.
      //
      // O AJUSTE PARCIAL VEM COMO SUCESSO, pela razao do antecipar: a rota
      // devolve 200 com `success: false` e `parcial` quando o laco parou no
      // meio, e aquilo e serie JA reescrita. Um toast de erro faria a pessoa
      // mandar o pedido de novo sobre uma cauda que mudou.
      toast.success(dados.message ?? "Empréstimo ajustado.");
      setAjustando(null);
      await carregar();
    } catch (e) {
      console.error("Erro ao ajustar o emprestimo:", e);
      toast.error("Não foi possível ajustar o empréstimo.");
    } finally {
      // A TRAVA E LIBERADA NOS TRES CAMINHOS, pela razao do antecipar: sem o
      // `delete`, o ajuste que falhou por rede nao teria segunda tentativa --
      // o botao voltaria a ficar habilitado e nao chamaria rota nenhuma.
      ajustandoRef.current.delete(emprestimo.id);
      setAjustesEmVoo((voando) => voando.filter((id) => id !== emprestimo.id));
    }
  }

  if (carregando) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Carregando o MyBank…</span>
      </div>
    );
  }

  // SEM CONTA DE INVESTIMENTO NAO HA MYBANK, e a tela diz o que fazer.
  //
  // Nao e gate de plano (Decisao 5 da HMO-368: quem tem conta de investimento
  // tem MyBank) -- e a ausencia do pre-requisito, com o caminho para resolve-la
  // na propria frase. Uma tela vazia aqui se leria como feature quebrada.
  if (contasCredoras.length === 0) {
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-2xl font-bold">MyBank</h1>
        <Card id="mybank-sem-conta">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PiggyBank className="h-4 w-4" />
              Você ainda não tem conta de investimento
            </CardTitle>
            <CardDescription>
              O MyBank empresta de uma conta de investimento sua. Cadastre uma em
              Contas e o empréstimo passa a ser possível.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <a href="/dashboard/contas">Ir para Contas</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-bold">MyBank</h1>
        <p className="text-sm text-muted-foreground">
          A sua conta de investimento emprestando — para você mesmo ou para uma
          conexão —, e a dívida voltando parcelada.
        </p>
      </div>

      {/* =====================================================================
          CABECALHO: o seletor da conta credora e os dois totais dela
          ===================================================================== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4" />
            Conta que empresta
          </CardTitle>
          <CardDescription>
            Só conta de investimento aparece aqui: é o que a trava do banco
            exige, e oferecer conta corrente seria oferecer uma opção que o
            empréstimo recusa.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <select
            id="mybank-conta"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={contaEscolhida ?? ""}
            onChange={(e) => setContaEscolhida(e.target.value)}
          >
            {contasCredoras.map((conta) => (
              <option key={conta.id} value={conta.id} data-conta={conta.id}>
                {rotuloDaContaCredora(conta)}
              </option>
            ))}
          </select>

          {/* OS TRES NUMEROS, COM ROTULO PROPRIO CADA UM. Ver
              `totaisDaContaCredora`: depois da primeira parcela paga de um
              emprestimo de R$ 24.000 o emprestado continua R$ 24.000 e o a
              receber e R$ 23.000 -- um numero so faria quem olha concluir que o
              outro esta errado.

              O TERCEIRO (HMO-450) E A PARTE-JURO DO QUE FALTA RECEBER, e ele
              existe porque com juro a diferenca entre os dois primeiros passou
              a misturar "o que ja voltou" com "o ganho que ainda vem". Cada
              rotulo diz o que o numero E -- ninguem precisa subtrair de cabeca.

              ELE APARECE SEMPRE, inclusive zerado no emprestimo a juro zero: um
              terceiro numero que some conforme o dado faria a mesma conta ter
              duas telas, e "sem juro nenhum" e justamente a informacao que o
              zero carrega. A legenda muda com ele para o zero nao se ler como
              numero que faltou carregar. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Total emprestado</p>
              <p
                id="mybank-total-emprestado"
                className="text-xl font-semibold"
              >
                {formatCurrency(totais.emprestado)}
              </p>
              <p className="text-xs text-muted-foreground">
                {totais.quantosEmprestimos} empréstimo
                {totais.quantosEmprestimos === 1 ? "" : "s"} em andamento
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Total a receber</p>
              <p id="mybank-a-receber" className="text-xl font-semibold">
                {formatCurrency(totais.aReceber)}
              </p>
              <p className="text-xs text-muted-foreground">
                {totais.quantasParcelasEmAberto} parcela
                {totais.quantasParcelasEmAberto === 1 ? "" : "s"} em aberto
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Juros a receber</p>
              <p id="mybank-juros-a-receber" className="text-xl font-semibold">
                {formatCurrency(totais.jurosAReceber)}
              </p>
              <p className="text-xs text-muted-foreground">
                {totais.jurosAReceber > 0
                  ? "já incluído no total a receber"
                  : "nenhum empréstimo com juros"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* =====================================================================
          NOVO EMPRESTIMO
          ===================================================================== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" />
            Novo empréstimo
          </CardTitle>
          <CardDescription>Juro zero nesta fase.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mybank-descricao">Para que é</Label>
            <Input
              id="mybank-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Moto elétrica"
            />
          </div>

          {/* QUEM PAGA: radio, e nao select, pelo mesmo motivo da pergunta da
              HMO-211 -- as duas respostas levam a telas diferentes (o Caso A
              cria conta a pagar minha; o Caso B nao cria linha minha nenhuma),
              e nenhuma delas e um padrao inofensivo. */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Quem paga</legend>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="mybank-quem-eu"
                  name="mybank_quem_paga"
                  value="eu"
                  checked={quemPaga === "eu"}
                  onChange={() => setQuemPaga("eu")}
                />
                <Label htmlFor="mybank-quem-eu">eu mesmo</Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="mybank-quem-conexao"
                  name="mybank_quem_paga"
                  value="conexao"
                  checked={quemPaga === "conexao"}
                  onChange={() => setQuemPaga("conexao")}
                />
                <Label htmlFor="mybank-quem-conexao">uma conexão</Label>
              </div>
            </div>
          </fieldset>

          {quemPaga === "conexao" ? (
            <div className="space-y-2">
              <Label htmlFor="mybank-devedor">Quem vai pagar</Label>
              {devedoresPossiveis.length === 0 ? (
                <p
                  id="mybank-sem-conexao"
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <Users className="h-4 w-4" />
                  Você ainda não tem conexão aceita. Convide a pessoa em Conexões
                  — só é possível emprestar para quem já aceitou.
                </p>
              ) : (
                <select
                  id="mybank-devedor"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={devedorId ?? ""}
                  onChange={(e) => setDevedorId(e.target.value || null)}
                >
                  <option value="">Escolha a pessoa</option>
                  {devedoresPossiveis.map((devedor) => (
                    <option
                      key={devedor.id}
                      value={devedor.id}
                      data-devedor={devedor.id}
                    >
                      {devedor.nome}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="mybank-conta-de-pagamento">
                Conta de onde as parcelas saem
              </Label>
              <select
                id="mybank-conta-de-pagamento"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={contaDePagamentoId ?? ""}
                onChange={(e) => setContaDePagamentoId(e.target.value || null)}
              >
                <option value="">Escolha a conta</option>
                {contasPagadoras.map((conta) => (
                  <option
                    key={conta.id}
                    value={conta.id}
                    data-pagadora={conta.id}
                  >
                    {rotuloDaContaCredora(conta)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                A parcela é gravada como transferência para a conta de
                investimento e aparece em Contas a Pagar com o selo MyBank: é
                dinheiro que sai da sua conta no dia do vencimento, e não
                dinheiro que deixou de ser seu.
              </p>
            </div>
          )}

          <div className="space-y-2">
            {/* O ROTULO MUDA COM O MODO: sem juro o campo e ambiguo de
                proposito (a pergunta abaixo o desambigua); com juro ele e o
                EMPRESTADO, e sem o rotulo dizer isso quem vinha do outro modo
                continuaria digitando a parcela. */}
            <Label htmlFor="mybank-valor">
              {rotuloDoCampoDeValor(modoDoJuro)}
            </Label>
            <CampoDeValor id="mybank-valor" value={valor} onChange={setValor} />
          </div>

          {/* O SELETOR DE MODO E OS CAMPOS DO JURO (HMO-448). */}
          <CamposDeJuros
            modo={modoDoJuro}
            aoEscolherModo={setModoDoJuro}
            taxa={taxaDoJuro}
            aoDigitarTaxa={setTaxaDoJuro}
            total={totalDoJuro}
            aoDigitarTotal={setTotalDoJuro}
            idPrefixo="mybank_"
          />

          {/* A PERGUNTA DA HMO-211, O MESMO COMPONENTE DO LANCAMENTO.
              `rotuloDoTotal` muda porque "o total da compra" e falso num
              emprestimo -- nao se compra nada.

              SO NO MODO SEM JURO: com juro a serie e montada sobre o total a
              receber, entao a base e `total` por construcao e esta pergunta
              passaria a oferecer uma escolha que o servidor ignora. E o
              seletor de modo acima e que ocupa o lugar dela, que e o que a
              issue pede com estas palavras. */}
          {!modoCobraJuro(modoDoJuro) && (
            <PerguntaDaBaseDoValor
              valor={base}
              aoEscolher={setBase}
              rotuloDoTotal="o total do empréstimo"
              idPrefixo="mybank_"
              nome="mybank_base_do_valor"
            />
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="mybank-parcelas">Parcelas</Label>
              <Input
                id="mybank-parcelas"
                type="text"
                inputMode="numeric"
                value={parcelas}
                onChange={(e) => setParcelas(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                De {MIN_PARCELAS_DO_MYBANK} a {MAX_PARCELAS_DO_MYBANK}.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mybank-vencimento">1º vencimento</Label>
              <CampoDeData
                id="mybank-vencimento"
                value={primeiroVencimento}
                onChange={setPrimeiroVencimento}
              />
            </div>
          </div>

          {resumo && (
            <p
              id="mybank-resumo"
              data-resumo
              className="rounded-md bg-muted p-3 text-sm"
            >
              {resumo}
            </p>
          )}

          {/* AS QUATRO GRANDEZAS ANTES DO CLIQUE (HMO-448).
              Ela vem DEPOIS do resumo de propósito: o resumo diz a serie
              ("12x de R$ 100 · total R$ 1.200"), e a previa diz de onde esse
              total saiu -- emprestado, juros, taxa. Invertidos, a pessoa leria
              o total duas vezes antes de saber que ha juro nele. */}
          <PreviaDoEmprestimo grandezas={previa} />

          {erro && (
            <p
              id="mybank-erro"
              className="flex items-start gap-2 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erro}</span>
            </p>
          )}

          <Button
            id="mybank-emprestar"
            onClick={emprestar}
            disabled={salvando}
            className="w-full sm:w-auto"
          >
            {salvando ? "Emprestando…" : "Emprestar"}
          </Button>
        </CardContent>
      </Card>

      {/* =====================================================================
          A CONFIRMAR -- quem deve avisou e eu ainda nao lancei (forma da HMO-366)
          ===================================================================== */}
      {aConfirmar.length > 0 && (
        <Card className="border-warning/40" id="mybank-a-confirmar">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {TITULO_A_CONFIRMAR_NO_MYBANK}
            </CardTitle>
            <CardDescription>
              {SUBTITULO_A_CONFIRMAR_NO_MYBANK}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {aConfirmar.map((linha) => (
              <div
                key={linha.id}
                data-confirmar={linha.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium">{linha.descricao}</p>
                  <p className="text-xs text-muted-foreground">
                    {linha.quemDevePagar} · parcela {linha.rotulo}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">
                    {formatCurrency(linha.valor)}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => confirmarRecebimento(linha.id)}
                  >
                    Confirmar
                  </Button>
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              {PARCELA_FORA_DO_REALIZADO}
            </p>
          </CardContent>
        </Card>
      )}

      {/* =====================================================================
          A LISTA DE EMPRESTIMOS -- os em andamento, e os encerrados atras de um
          botao (HMO-398)
          ===================================================================== */}
      <Card data-card-da-lista>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Empréstimos desta conta</CardTitle>
          {/* O SUBTITULO CONTA OS DOIS GRUPOS, inclusive com a secao fechada.

              Sem ele, a unica leitura disponivel para quem acabou de pagar a
              ultima parcela seria "a linha desapareceu" -- e o card ficaria com
              a aparencia de mostrar tudo o que tem, que e o defeito que esta
              issue veio consertar e nao repetir. Ver `resumo` em
              `recorteDaListaDeEmprestimos`. */}
          <CardDescription data-resumo-da-lista>
            {recorteDaLista.resumo}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {doEscolhido.length === 0 ? (
            <p id="mybank-sem-emprestimo" className="text-sm text-muted-foreground">
              Esta conta ainda não emprestou nada.
            </p>
          ) : (
            <div className="space-y-3">
              {recorteDaLista.visiveis.map((emprestimo) => {
                const vencimento = proximoVencimento(emprestimo);
                const parcela = valorDaParcelaNaLista(emprestimo);
                const emAberto = quantasEmAbertoNoEmprestimo(emprestimo);
                const antecipadas = rotuloDasParcelasAntecipadas(emprestimo);

                // A PREVIA SO E MONTADA COM O DIALOGO ABERTO. Ela percorre a
                // serie inteira tres vezes (escolher a cauda, somar, achar o
                // ultimo vencimento), e fazer isso para as 24 parcelas de todos
                // os emprestimos da conta em cada render seria trabalho jogado
                // fora -- e, com `quantasParaAntecipar` sendo um estado SO, a
                // previa dos outros falaria da quantidade escolhida neste.
                const previa =
                  antecipando === emprestimo.id
                    ? previaDaAntecipacaoNaTela(
                        emprestimo,
                        Number(quantasParaAntecipar)
                      )
                    : null;

                // O PEDIDO E A PREVIA DO AJUSTE, SO PARA A LINHA ABERTA
                // (HMO-480) -- pela razao da `previa` acima: o formulario e um
                // estado SO, entao a previa das outras linhas falaria dos
                // campos digitados NESTA.
                //
                // O `pedido` e calculado aqui e nao dentro do `fetch` porque a
                // tela precisa dele para TRES coisas: a previa, o `disabled` do
                // botao e a ancora que a sonda le. O que o handler manda e
                // recalculado da mesma funcao -- de proposito, para que o corpo
                // do PATCH nao dependa de um render ter acontecido.
                const pedidoDoAjuste =
                  ajustando === emprestimo.id
                    ? pedidoDoAjusteDaTela(formularioDoAjuste)
                    : null;

                const previaDoAjusteDaLinha = pedidoDoAjuste
                  ? previaDoAjuste({
                      emprestimo,
                      parcelas: parcelasParaAjustar(emprestimo.parcelas),
                      pedido: pedidoDoAjuste,
                    })
                  : null;

                // A FRASE DO EMPRESTADO (HMO-479), e ela vem da MESMA funcao
                // pura que a previa -- nao de um `juro ? ... : ...` escrito no
                // JSX logo abaixo. Escrita la, ela ficaria fora do alcance de
                // todo mutante desta lib e a suite nao veria a troca de ramo
                // (`provar-handler-react-em-chromium-commitado`), que e
                // exatamente o estrago: a frase do ramo errado AFIRMA que o
                // emprestado nao muda no unico ramo em que ele muda.
                const fraseDoEmprestado = pedidoDoAjuste
                  ? fraseDoEmprestadoNoAjuste({
                      emprestimo,
                      parcelas: parcelasParaAjustar(emprestimo.parcelas),
                      pedido: pedidoDoAjuste,
                    })
                  : null;

                // O MARCADOR DA LINHA ENCERRADA, e ele e um ATRIBUTO proprio
                // (`data-encerrado`). A posicao na lista nao serve: aberta, os
                // encerrados vem DEPOIS dos em andamento, e uma assercao por
                // indice continuaria passando com os dois grupos embaralhados.
                const encerrado = emprestimoEncerrado(emprestimo);

                return (
                  <div
                    key={emprestimo.id}
                    data-emprestimo={emprestimo.id}
                    data-encerrado={encerrado ? "sim" : undefined}
                    className={
                      encerrado
                        ? "space-y-1 rounded-lg border border-dashed p-3 opacity-70"
                        : "space-y-1 rounded-lg border p-3"
                    }
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{emprestimo.descricao}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" data-progresso>
                          {progressoDoEmprestimo(emprestimo)}
                        </Badge>
                        {/* O BOTAO SO EM `active`, E A CONDICAO E O STATUS DA
                            LINHA -- nao "tem parcela em aberto".

                            Emprestimo `settled` ou `cancelled` nao tem o que
                            encerrar, e a rota recusa os dois com frase propria;
                            oferecer o botao ali seria oferecer um clique cujo
                            unico resultado possivel e um toast de erro. E a
                            condicao e o status e nao as parcelas porque um
                            emprestimo `active` com todas as parcelas pagas AINDA
                            precisa de saida -- e o caso que abriu a HMO-383.

                            Desde a HMO-394 o ciclo de pagamento escreve
                            `settled`, entao esse estado deixou de nascer: quem
                            paga a ultima parcela ve a linha sair do painel
                            quitada, e nao com o botao Cancelar. Mas ele nao
                            desapareceu -- os emprestimos que quitaram ANTES
                            daquela entrega seguem `active`, e e por eles que a
                            condicao continua sendo o status. */}
                        {/* O GESTO DE ANTECIPAR, E A CONDICAO DELE E OUTRA
                            (HMO-397).

                            `podeAntecipar` e `active` **E** com parcela em
                            aberto -- diferente do Cancelar logo abaixo, que e so
                            pelo status, de proposito. O porque das duas
                            condicoes diferentes esta na funcao, em `lib/`: o
                            emprestimo `active` com a serie toda paga (os que
                            quitaram antes da HMO-394) ainda precisa de saida, e
                            nao tem o que antecipar. */}
                        {podeAntecipar(emprestimo) && (
                          <Button
                            variant="outline"
                            size="sm"
                            data-antecipar-emprestimo={emprestimo.id}
                            onClick={() => abrirAntecipacao(emprestimo)}
                          >
                            Antecipar
                          </Button>
                        )}
                        {/* O GESTO DE AJUSTAR (HMO-480), E A CONDICAO E O
                            STATUS -- a mesma do Cancelar, e nao a do
                            Antecipar.

                            `problemaDoAjuste` recusa `settled` e `cancelled`
                            com `emprestimo_nao_esta_ativo`, entao fora de
                            `active` o botao seria um clique cujo unico
                            resultado possivel e um toast de erro.

                            E ELA NAO PEDE PARCELA EM ABERTO, ao contrario de
                            `podeAntecipar`: a propria rota diz por que ("a
                            descricao sozinha nao precisa de parcela pendente
                            nenhuma"), e trocar o texto de um emprestimo com as
                            24 parcelas pagas e um conserto legitimo. Quem
                            recusa o pedido que MEXE NA SERIE sem pendente e
                            `sem_parcela_pendente`, e ela sabe distinguir os
                            dois casos; o botao nao. */}
                        {/* OS DOIS DENTRO DO MESMO `active`, E A UNIAO FOI
                            MEDIDA (HMO-480).

                            A condicao e a MESMA, e escreve-la duas vezes tem
                            dois precos. O de produto: duas condicoes identicas
                            convidam a mexer numa so. O de MEDICAO, que foi o
                            medido aqui: o mutante "O BOTAO CANCELAR APARECE EM
                            EMPRESTIMO JA ENCERRADO" de
                            `mutantes-mybank-na-tela.mjs` ancora exatamente
                            nesta linha, e com ela repetida a ancora dele vira
                            AMBIGUA (2 ocorrencias) -- o
                            `check-ancora-de-mutante` reprova, e um `replace`
                            que casa duas vezes muta so a PRIMEIRA, medindo um
                            lugar que o rotulo dele nao descreve
                            (`funcao-nova-que-copia-criterio-torna-ancora-alheia-ambigua`).

                            Unidos, aquele mutante passa a fazer os DOIS botoes
                            aparecerem no encerrado -- o que o rotulo dele
                            segue descrevendo certo, e que as duas assercoes
                            matam: a dele (`k_com_cancelar`) e a desta filha
                            (`m_botoes.comAjustar`). */}
                        {emprestimo.status === "active" && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              data-ajustar-emprestimo={emprestimo.id}
                              onClick={() => abrirAjuste(emprestimo)}
                            >
                              Ajustar
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              data-cancelar-emprestimo={emprestimo.id}
                              onClick={() => cancelarEmprestimo(emprestimo)}
                            >
                              Cancelar
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <span data-devedor-do-emprestimo>
                        {emprestimo.quem_deve_pagar}
                      </span>
                      {parcela !== null && (
                        <> · {formatCurrency(parcela)} por parcela</>
                      )}
                      {vencimento ? (
                        <> · vence {dataOuMomentoNaTela(vencimento)}</>
                      ) : (
                        <> · nada em aberto</>
                      )}
                      {" · "}
                      {/* O STATUS EM PORTUGUES, e numa ancora propria.

                          A linha imprimia `emprestimo.status` CRU -- "settled"
                          e "cancelled", os valores do CHECK da 053, numa tela em
                          portugues. E ela e a leitura que distingue um
                          emprestimo quitado de um cancelado DENTRO da secao dos
                          encerrados, onde os dois convivem. */}
                      <span data-status-do-emprestimo>
                        {rotuloDoStatusDoEmprestimo(emprestimo)}
                      </span>
                      {/* A PARCELA ANTECIPADA SE DISTINGUE, E SEM COLUNA NOVA
                          (HMO-397).

                          Ela e o que explica o `4/24` do badge acima ao lado de
                          "vence <parcela 3>": quatro pagas com a terceira ainda
                          pendente e uma tela que pede explicacao, e sem ela a
                          unica conclusao disponivel e "a contagem esta errada"
                          -- que e justamente a leitura que a secao 0 do plano
                          mediu como CERTA. O criterio e `paid_date < due_date`,
                          derivado (a forma da HMO-366), nao uma coluna. */}
                      {antecipadas !== null && (
                        <> · <span data-antecipadas>{antecipadas}</span></>
                      )}
                    </p>

                    {/* ====================================================
                        O DIALOGO DE ANTECIPAR -- os tres numeros ANTES do clique
                        ==================================================== */}
                    {previa !== null && (
                      <div
                        data-dialogo-antecipacao={emprestimo.id}
                        className="mt-2 space-y-2 rounded-lg border border-warning/40 bg-muted/40 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Label
                            htmlFor={`mybank-antecipar-quantas-${emprestimo.id}`}
                            className="text-xs"
                          >
                            Quantas parcelas antecipar?
                          </Label>
                          {/* UM `<select>` NATIVO DE 1 ATE AS EM ABERTO, E NAO
                              UM CAMPO DE NUMERO.

                              Tres razoes, e as tres sao medidas:

                                * `mais_do_que_em_aberto` deixa de ser
                                  alcancavel pela tela -- a recusa esta na FORMA
                                  do campo, nao numa validacao que alguem pode
                                  afrouxar (a mesma escolha que tirou `valor` do
                                  corpo da rota);
                                * `<input type="number">` descarta a virgula e
                                  aceita texto vazio no `value` do navegador, e
                                  um campo vazio aqui mandaria `parcelas: NaN`;
                                * nativo e nao o Select do Radix pela razao que o
                                  cabecalho deste arquivo ja da: o Radix monta as
                                  `<option>` num PORTAL e so quando o menu abre,
                                  entao a assercao "o seletor oferece no maximo
                                  as em aberto" leria uma lista vazia e passaria
                                  verde. */}
                          <select
                            id={`mybank-antecipar-quantas-${emprestimo.id}`}
                            data-antecipar-quantas={emprestimo.id}
                            value={quantasParaAntecipar}
                            onChange={(e) =>
                              setQuantasParaAntecipar(e.target.value)
                            }
                            className="h-9 rounded-md border bg-background px-2 text-sm"
                          >
                            {Array.from({ length: emAberto }, (_, i) => (
                              <option key={i + 1} value={String(i + 1)}>
                                {i + 1}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* A PREVIA, E O TEXTO VEM DE `lib/`.

                            Escrito aqui ele passaria por qualquer suite intacto
                            -- e a razao que `avisoDoCancelamento` ja da. O valor
                            chega FORMATADO porque `lib/emprestimo-do-mybank`
                            nao importa `formatCurrency` de proposito (seria o
                            segundo formatador de real do app). */}
                        <p
                          data-previa-antecipacao={emprestimo.id}
                          className="text-xs text-muted-foreground"
                        >
                          {previaDaAntecipacao({
                            numeros: previa.numeros,
                            valorFormatado: formatCurrency(previa.valor),
                            ultimoVencimentoAntes: previa.ultimoVencimentoAntes,
                            ultimoVencimentoDepois:
                              previa.ultimoVencimentoDepois,
                            caso: emprestimo.caso,
                          })}
                        </p>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            data-confirmar-antecipacao={emprestimo.id}
                            disabled={antecipacoesEmVoo.includes(emprestimo.id)}
                            onClick={() => antecipar(emprestimo)}
                          >
                            {antecipacoesEmVoo.includes(emprestimo.id)
                              ? "Antecipando…"
                              : "Confirmar antecipação"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            data-fechar-antecipacao={emprestimo.id}
                            onClick={() => setAntecipando(null)}
                          >
                            Voltar
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* ====================================================
                        O DIALOGO DE AJUSTAR -- os quatro campos da rota (HMO-480)
                        ====================================================
                        IRMAO DO DE ANTECIPAR LOGO ACIMA: mesmo lugar (dentro da
                        linha, nao num modal), mesma caixa, mesma disciplina de
                        `...EmVooRef`, e a mesma razao para nao ser um
                        `confirm()` -- o gesto PEDE valores, e os numeros que a
                        pessoa precisa ler mudam com o que ela digita. Um
                        `confirm()` mostraria o estado de antes da escolha.

                        A CAIXA APARECE PELO `ajustando`, E NAO PELA PREVIA, e a
                        diferenca e o caso de abertura: `previaDoAjuste` devolve
                        `null` com o formulario intocado (de proposito), e
                        condicionar a caixa a ela faria o clique em "Ajustar"
                        nao abrir nada. O dialogo de antecipar pode se
                        condicionar a previa porque lá a quantidade ja nasce em
                        "1"; aqui nascer vazio e a feature. */}
                    {ajustando === emprestimo.id && (
                      <div
                        data-dialogo-ajuste={emprestimo.id}
                        className="mt-2 space-y-3 rounded-lg border border-warning/40 bg-muted/40 p-3"
                      >
                        {/* A FRASE QUE EXPLICA O CAMPO VAZIO.
                            Sem ela, quatro campos em branco se leem como "a
                            tela nao carregou os valores" -- e a pessoa
                            preencheria os quatro para "confirmar" o que ja
                            esta certo, que e exatamente o pedido que esta
                            feature evita montar. */}
                        <p className="text-xs text-muted-foreground">
                          Preencha só o que quer mudar. Campo em branco fica
                          como está.
                        </p>

                        <div className="space-y-1">
                          <Label
                            htmlFor={`mybank-ajuste-descricao-${emprestimo.id}`}
                            className="text-xs"
                          >
                            Nova descrição
                          </Label>
                          <Input
                            id={`mybank-ajuste-descricao-${emprestimo.id}`}
                            data-ajuste-descricao={emprestimo.id}
                            value={formularioDoAjuste.descricao}
                            onChange={(e) =>
                              setFormularioDoAjuste((atual) => ({
                                ...atual,
                                descricao: e.target.value,
                              }))
                            }
                            // O PLACEHOLDER MOSTRA O TEXTO DE HOJE, E O `value`
                            // FICA VAZIO. E o unico jeito de a pessoa LER a
                            // descricao atual sem que ela viaje no corpo do
                            // PATCH: `placeholder` nao e valor, nao entra no
                            // `e.target.value` e nao e lido por
                            // `pedidoDoAjusteDaTela`.
                            placeholder={emprestimo.descricao}
                            autoComplete="off"
                          />
                        </div>

                        {/* O ALTERNADOR DA F3, COM OS ROTULOS DO AJUSTE.
                            `rotuloDoModoDoAjuste` troca "Sem juros" por "Não
                            mexer nos juros" -- ver ZERAR O JURO em
                            `lib/ajuste-do-emprestimo-na-tela.ts`. O componente e o mesmo
                            porque o que importa dele e a EXCLUSIVIDADE: um modo,
                            logo um campo no DOM, logo `taxa_e_total_juntos`
                            inalcancavel pela tela. */}
                        <CamposDeJuros
                          modo={formularioDoAjuste.modoDoJuro}
                          aoEscolherModo={(modo) =>
                            setFormularioDoAjuste((atual) => ({
                              ...atual,
                              modoDoJuro: modo,
                            }))
                          }
                          taxa={formularioDoAjuste.taxa}
                          aoDigitarTaxa={(taxa) =>
                            setFormularioDoAjuste((atual) => ({
                              ...atual,
                              taxa,
                            }))
                          }
                          total={formularioDoAjuste.total}
                          aoDigitarTotal={(total) =>
                            setFormularioDoAjuste((atual) => ({
                              ...atual,
                              total,
                            }))
                          }
                          // O PREFIXO LEVA O ID DO EMPRESTIMO, e nao e enfeite:
                          // o `name` dos radios sai dele, e dois dialogos com o
                          // mesmo `name` seriam UM grupo para o navegador --
                          // escolher o modo num desmarcaria o do outro.
                          idPrefixo={`mybank_ajuste_${emprestimo.id}_`}
                          rotuloDoModo={rotuloDoModoDoAjuste}
                        />

                        <div className="space-y-1">
                          <Label
                            htmlFor={`mybank-ajuste-vencimento-${emprestimo.id}`}
                            className="text-xs"
                          >
                            Novo vencimento da primeira parcela em aberto
                          </Label>
                          <CampoDeData
                            id={`mybank-ajuste-vencimento-${emprestimo.id}`}
                            value={formularioDoAjuste.primeiroVencimentoDaCauda}
                            onChange={(data) =>
                              setFormularioDoAjuste((atual) => ({
                                ...atual,
                                primeiroVencimentoDaCauda: data,
                              }))
                            }
                          />
                          {/* A DATA E DA PRIMEIRA EM ABERTO, E AS OUTRAS
                              SEGUEM. `caudaRecalculada` remonta a serie a
                              partir dela de mes em mes; sem esta frase, "novo
                              vencimento" se leria como "muda so esta
                              parcela". */}
                          <p className="text-xs text-muted-foreground">
                            As seguintes andam de mês em mês a partir dela.
                          </p>
                        </div>

                        {/* A PREVIA, E ELA E O MESMO COMPONENTE DA CRIACAO.
                            `previaDoAjuste` devolve a lista de grandezas e o
                            componente desenha -- nenhuma conta no JSX. Ver A
                            PREVIA NAO FAZ CONTA NENHUMA em
                            `lib/ajuste-do-emprestimo-na-tela.ts`. */}
                        <div data-previa-ajuste={emprestimo.id}>
                          <PreviaDoEmprestimo
                            grandezas={previaDoAjusteDaLinha}
                          />
                          {/* A FRASE DO EMPRESTADO (HMO-479, item 4 da issue).
                              DENTRO da caixa da previa e nao acima do dialogo:
                              ela fala do R$ da linha `emprestado` que esta logo
                              acima dela, e os dois numeros tem de ser lidos
                              juntos -- separados pelos tres campos, a frase
                              viraria texto de ajuda que ninguem liga ao valor.

                              `null` NAO DESENHA O PARAGRAFO, pela razao da
                              propria funcao: o pedido que so troca a descricao
                              nao tem noticia sobre o emprestado, e um `<p>`
                              vazio deixaria o espaco reservado piscando entre
                              os ramos. */}
                          {fraseDoEmprestado && (
                            <p
                              data-frase-do-emprestado={emprestimo.id}
                              className="mt-2 text-xs text-muted-foreground"
                            >
                              {fraseDoEmprestado}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            data-confirmar-ajuste={emprestimo.id}
                            // DUAS RAZOES PARA O `disabled`, E AS DUAS SAO
                            // DIFERENTES: sem campo tocado o corpo seria `{}` e
                            // a rota responderia `nada_a_ajustar` (um erro que a
                            // pessoa nao causou -- ela so abriu o dialogo); e
                            // com o PATCH em voo e o latch de duplo clique, que
                            // o ref ja segura e este `disabled` MOSTRA.
                            disabled={
                              !pedidoAjustaAlgumCampo(
                                pedidoDoAjuste ?? {}
                              ) || ajustesEmVoo.includes(emprestimo.id)
                            }
                            onClick={() => ajustarEmprestimo(emprestimo)}
                          >
                            {ajustesEmVoo.includes(emprestimo.id)
                              ? "Ajustando…"
                              : "Ajustar"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            data-fechar-ajuste={emprestimo.id}
                            onClick={() => setAjustando(null)}
                          >
                            Voltar
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* A CONTA QUE SO TEM DIVIDA ENCERRADA, com a secao fechada.

                  Sem esta frase a area da lista ficaria em branco, e branco se
                  le como "nao tem nada" -- exatamente o que o botao logo abaixo
                  desmente. Ela e condicionada aos EM ANDAMENTO e nao ao total:
                  "Esta conta ainda nao emprestou nada" (acima) e outra coisa, e
                  seria uma frase falsa aqui. */}
              {recorteDaLista.emAndamento.length === 0 && (
                <p
                  id="mybank-nada-em-andamento"
                  className="text-sm text-muted-foreground"
                >
                  Nada em andamento nesta conta.
                </p>
              )}
            </div>
          )}

          {/* O BOTAO DOS ENCERRADOS -- e o rotulo DIZ QUANTOS, nao "Ver mais".

              `rotuloDoBotao === null` quando nao ha encerrado nenhum: nenhum
              botao, e o estado de abertura nao pode produzir duas telas
              diferentes para a mesma conta. A mesma forma de `blocoDoDevedor`.

              O rotulo com o NUMERO e o que separa o colapso de "o resto nao
              existe" -- `sumido-da-tela-pode-ser-so-indistinguivel`. */}
          {recorteDaLista.rotuloDoBotao !== null && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              data-encerrados-do-mybank
              onClick={() => setEncerradosAbertos((antes) => !antes)}
            >
              {recorteDaLista.rotuloDoBotao}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* =====================================================================
          "A RECEBER" -- uma linha por parcela em aberto, com os TRES campos
          ===================================================================== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">A receber</CardTitle>
          <CardDescription>
            Uma linha por parcela em aberto, com o valor, a parcela e quem deve
            pagar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {aReceber.length === 0 ? (
            <p id="mybank-sem-receber" className="text-sm text-muted-foreground">
              Nada a receber nesta conta.
            </p>
          ) : (
            <div className="space-y-2">
              {aReceber.map((linha) => (
                <div
                  key={linha.id}
                  data-receber={linha.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{linha.descricao}</p>
                    {/* OS TRES CAMPOS DA ISSUE, cada um na sua ancora.

                        `data-quem-deve` existe para a sonda poder afirmar que
                        ESTE campo esta na linha: sem ele, uma assercao sobre o
                        texto da linha inteira continuaria passando com o nome
                        apagado, porque "Você mesmo" e o nome da conexao
                        aparecem em outros lugares da tela. */}
                    <p className="text-xs text-muted-foreground">
                      <span data-quem-deve>{linha.quemDevePagar}</span>
                      {" · parcela "}
                      <span data-parcela-rotulo>{linha.rotulo}</span>
                      {" · vence "}
                      {dataOuMomentoNaTela(linha.vencimento)}
                    </p>
                  </div>
                  <span data-valor className="font-semibold">
                    {formatCurrency(linha.valor)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
