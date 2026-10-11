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
// `mybank-devedor`, `mybank-erro` e os `data-*` das linhas sao lidos pela sonda
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

import { formatCurrency } from "@/lib/utils";
import { dataOuMomentoNaTela } from "@/lib/data-na-tela";
import {
  mensagemDoProblema,
  problemaDoEmprestimo,
  serieDoEmprestimo,
  casoDoEmprestimo,
  JUROS_DA_FASE_1,
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
  linhasAReceber,
  progressoDoEmprestimo,
  proximoVencimento,
  rotuloDaContaCredora,
  totaisDaContaCredora,
  valorDaParcelaNaLista,
  type ConexaoCrua,
  type ContaNaTelaDoMyBank,
  type EmprestimoDoMyBank,
} from "@/lib/mybank-na-tela";

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

  const serie = useMemo(
    () =>
      serieDoEmprestimo({
        valor,
        base,
        parcelas: numeroDeParcelas,
        primeiroVencimento,
      }),
    [valor, base, numeroDeParcelas, primeiroVencimento]
  );

  const resumo = resumoDaSerie(serie);

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
    base,
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
    juros: JUROS_DA_FASE_1,
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
          juros: JUROS_DA_FASE_1,
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

          {/* OS DOIS NUMEROS, COM ROTULO PROPRIO CADA UM. Ver
              `totaisDaContaCredora`: depois da primeira parcela paga de um
              emprestimo de R$ 24.000 o emprestado continua R$ 24.000 e o a
              receber e R$ 23.000 -- um numero so faria quem olha concluir que o
              outro esta errado. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <Label htmlFor="mybank-valor">Valor</Label>
            <CampoDeValor id="mybank-valor" value={valor} onChange={setValor} />
          </div>

          {/* A PERGUNTA DA HMO-211, O MESMO COMPONENTE DO LANCAMENTO.
              `rotuloDoTotal` muda porque "o total da compra" e falso num
              emprestimo -- nao se compra nada. */}
          <PerguntaDaBaseDoValor
            valor={base}
            aoEscolher={setBase}
            rotuloDoTotal="o total do empréstimo"
            idPrefixo="mybank_"
            nome="mybank_base_do_valor"
          />

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
          A LISTA DE EMPRESTIMOS
          ===================================================================== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Empréstimos desta conta</CardTitle>
        </CardHeader>
        <CardContent>
          {doEscolhido.length === 0 ? (
            <p id="mybank-sem-emprestimo" className="text-sm text-muted-foreground">
              Esta conta ainda não emprestou nada.
            </p>
          ) : (
            <div className="space-y-3">
              {doEscolhido.map((emprestimo) => {
                const vencimento = proximoVencimento(emprestimo);
                const parcela = valorDaParcelaNaLista(emprestimo);

                return (
                  <div
                    key={emprestimo.id}
                    data-emprestimo={emprestimo.id}
                    className="space-y-1 rounded-lg border p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{emprestimo.descricao}</p>
                      <Badge variant="outline" data-progresso>
                        {progressoDoEmprestimo(emprestimo)}
                      </Badge>
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
                      {emprestimo.status}
                    </p>
                  </div>
                );
              })}
            </div>
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
