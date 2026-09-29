"use client";

// ---------------------------------------------------------------------------
// O FORMULARIO DE LANCAMENTO, UM POR TIPO (HMO-165)
// ---------------------------------------------------------------------------
// Este e o container: ele carrega o catalogo, decide como gravar e trata a
// falta de rede. Os campos em si estao em `CamposDeLancamento`, e as regras em
// `lib/lancamento.ts`.
//
// Ele atende as DUAS telas (`/movimentacoes/receita` e `/movimentacoes/despesa`)
// com a prop `tipo`. Duas copias deste arquivo divergiriam na primeira mudanca,
// e a contabilizacao e justamente onde divergir custa dinheiro -- foi assim que
// a transferencia passou a contar duas vezes.
//
// O QUE NAO PODE SE PERDER AQUI (tudo herdado da tela antiga):
//
//   - Despesa fixa NAO e lancamento: vai para `recurring_rules` (005). Gravar
//     tambem uma transacao cobraria o valor duas vezes.
//   - Despesa no cartao e a mesma transacao numa conta `credit_card`: e o
//     `account_type` que faz a compra entrar na fatura (006).
//   - Editar nunca cai em "fixa": transacao gravada e lancamento, nao regra.
//   - `getUser()` devolve `user: null` SEM lancar quando falta rede. Um
//     `if (!user) return` aqui mata o modo offline sem erro nenhum.
//   - Despesa e gravada NEGATIVA (`valorGravado`).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SoftFeatureGuard } from "@/components/subscription/SoftFeatureGuard";
import { ArrowLeft, Trash2, TrendingDown, TrendingUp, Users } from "lucide-react";
import { CamposDeLancamento } from "@/components/movimentacoes/CamposDeLancamento";
import { usePreferenciaDeMoeda } from "@/lib/hooks/usePreferenciaDeMoeda";
import { moedaSugerida } from "@/lib/moeda";
import { avisoDeEdicaoTravada } from "@/lib/grupos";
import { useOfflineQueue } from "@/lib/hooks/useOfflineQueue";
import {
  camposDoTipo,
  regraDeRecorrencia,
  valoresIniciais,
  validarLancamento,
  valorGravado,
  type CategoriaDeLancamento,
  type ContaDeLancamento,
  type TipoLancamento,
  type ValoresDeLancamento,
} from "@/lib/lancamento";
import {
  guardarCatalogo,
  lerCatalogo,
  decidirAbertura,
  type CatalogoDeLancamento,
} from "@/lib/offline-cache";
import {
  classificarFalhaDeAuth,
  lerSessaoLembrada,
} from "@/lib/offline-session";

interface Conexao {
  id: string;
  full_name: string;
  avatar_url?: string;
}

const COPIA = {
  income: {
    titulo: "Nova Receita",
    descricao:
      "Dinheiro que entrou: salário, venda, rendimento, reembolso. Pode ser pontual ou fixa mensal.",
    salvar: "Salvar receita",
    salvo: "Receita lançada.",
    atualizado: "Receita atualizada.",
    regraCriada: "Receita fixa criada. Ela aparece em Contas Previstas.",
    erroDaRegra: "Erro ao criar a receita fixa",
  },
  expense: {
    titulo: "Nova Despesa",
    descricao:
      "Dinheiro que saiu. Pode ser pontual, no cartão, fixa mensal ou parcelada.",
    salvar: "Salvar despesa",
    salvo: "Despesa lançada.",
    atualizado: "Despesa atualizada.",
    regraCriada: "Despesa fixa criada. Ela aparece em Contas Previstas.",
    erroDaRegra: "Erro ao criar a despesa fixa",
  },
} as const;

export function FormularioDeLancamento({ tipo }: { tipo: TipoLancamento }) {
  const router = useRouter();
  const parametros = useSearchParams();
  /** `?id=` chega do botao de editar da lista de lancamentos. */
  const idParaEditar = parametros.get("id");

  const [user, setUser] = useState<User | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [categorias, setCategorias] = useState<CategoriaDeLancamento[]>([]);
  const [contas, setContas] = useState<ContaDeLancamento[]>([]);
  const [grupos, setGrupos] = useState<any[]>([]);
  const [conexoes, setConexoes] = useState<Conexao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  /** De quando sao os dados na tela, quando eles vieram do aparelho. */
  const [catalogoDe, setCatalogoDe] = useState<number | null>(null);
  const [valores, setValores] = useState<ValoresDeLancamento>(valoresIniciais);
  const [editando, setEditando] = useState(false);
  // Decide se a checkbox de moeda aparece, e qual moeda um lancamento novo ganha.
  const { moeda: preferenciaDeMoeda, carregando: carregandoMoeda } =
    usePreferenciaDeMoeda();

  // A moeda oficial chega DEPOIS do primeiro render (ela vem de `fetch`), e
  // `valoresIniciais()` nao pode conhece-la -- aquele modulo nao importa nada, de
  // proposito. Sem este efeito, quem configurou dolar como moeda principal abre
  // um lancamento novo em REAIS e so descobre ao olhar o simbolo do campo de
  // valor.
  //
  // As tres guardas importam:
  //   - `carregandoMoeda` evita escrever a preferencia padrao (BRL) em cima de
  //     algo antes de saber a de verdade;
  //   - `editando` protege o lancamento que ja existe: a moeda dele veio do
  //     banco e a oficial nao pode sobrepo-la;
  //   - `contaId` vazio limita a correcao ao caso em que nao ha conta escolhida.
  //     Com conta escolhida quem manda e a moeda DELA, e o seletor de conta ja
  //     cuida disso.
  useEffect(() => {
    if (carregandoMoeda || editando) return;
    setValores((atual) =>
      atual.moedaSobreposta || atual.contaId
        ? atual
        : { ...atual, moeda: preferenciaDeMoeda.oficial }
    );
  }, [carregandoMoeda, editando, preferenciaDeMoeda.oficial]);

  const { online, enfileirar } = useOfflineQueue();
  const supabase = createClient();
  const copia = COPIA[tipo];
  const campos = camposDoTipo(tipo, valores.natureza, editando);

  const aoMudar = useCallback((mudanca: Partial<ValoresDeLancamento>) => {
    setValores((atual) => ({ ...atual, ...mudanca }));
  }, []);

  /**
   * Repoe na tela o que o aparelho guardou da ultima vez que ela carregou com
   * rede. Existe como funcao propria porque ha DOIS caminhos sem rede, e so um
   * deles passa pelo catch.
   */
  const reporCatalogo = (catalogo: CatalogoDeLancamento) => {
    setServiceId(catalogo.serviceId);
    setCategorias(catalogo.categorias as CategoriaDeLancamento[]);
    setContas(catalogo.contas);
    setCatalogoDe(catalogo.guardadoEm);
    toast.message("Sem conexão: dá para lançar, envio quando a rede voltar.");
  };

  const avisarAparelhoVazio = () => {
    toast.error(
      "Sem conexão e sem dados no aparelho. Abra esta tela uma vez com internet."
    );
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = async () => {
    try {
      const { data: dadosDeAuth, error: erroDeAuth } =
        await supabase.auth.getUser();

      if (!dadosDeAuth?.user) {
        // `getUser()` vai na rede, e quando a rede falha o supabase-js NAO
        // lanca: ele devolve `user: null` com o erro ao lado. Um
        // `if (!user) return` aqui sairia ANTES do caminho que sabe repor o
        // catalogo, e a tela terminaria sem categoria, sem conta e sem
        // `serviceId` -- sem nada disso aparecer como erro.
        const abertura = decidirAbertura({
          usuarioConfirmado: null,
          origemDaFalha: classificarFalhaDeAuth(erroDeAuth),
          sessaoLembrada: lerSessaoLembrada(window.localStorage),
          catalogo: lerCatalogo(window.localStorage),
        });

        // O servidor respondeu que a sessao nao vale: quem manda para /login e
        // o layout do dashboard. Nao ha o que repor.
        if (abertura.decisao === "desistir") return;

        if (abertura.usuario) {
          setUser({
            id: abertura.usuario.id,
            email: abertura.usuario.email ?? undefined,
          } as User);
        }

        if (abertura.catalogo) reporCatalogo(abertura.catalogo);
        else avisarAparelhoVazio();

        return;
      }

      const usuario = dadosDeAuth.user;
      setUser(usuario);

      const { data: servico } = await supabase
        .from("financial_services")
        .select("id")
        .eq("name", "personal_finance")
        .single();

      // Guardados em variavel, e nao lidos do estado depois: `setCategorias` so
      // vale no proximo render, e o catalogo e gravado ainda dentro desta
      // funcao -- lendo do estado ele salvaria a lista do carregamento
      // ANTERIOR, e na primeira visita salvaria vazio.
      let categoriasCarregadas: CategoriaDeLancamento[] = [];
      let contasCarregadas: ContaDeLancamento[] = [];

      if (servico) {
        setServiceId(servico.id);

        const { data: dadosDeCategorias } = await supabase
          .from("transaction_categories")
          .select("id, name, is_expense")
          .eq("service_id", servico.id)
          .eq("is_active", true)
          .order("name");

        categoriasCarregadas = dadosDeCategorias || [];
        setCategorias(categoriasCarregadas);
      }

      const respostaDeContas = await fetch("/api/financial-accounts");
      const dadosDeContas = await respostaDeContas.json();
      if (respostaDeContas.ok) {
        contasCarregadas = dadosDeContas.accounts || [];
        setContas(contasCarregadas);
      }

      // Grupo e conexao so servem para despesa. Buscar as duas na tela de
      // receita gastaria duas requisicoes para alimentar um bloco que
      // `camposDoTipo` nao mostra.
      if (tipo === "expense") {
        const respostaDeGrupos = await fetch("/api/expense-groups");
        const dadosDeGrupos = await respostaDeGrupos.json();
        if (respostaDeGrupos.ok) setGrupos(dadosDeGrupos.groups || []);

        const respostaDeConexoes = await fetch(
          "/api/personal-finance/connections"
        );
        if (respostaDeConexoes.ok) {
          const dadosDeConexoes = await respostaDeConexoes.json();
          setConexoes(dadosDeConexoes.connections || []);
        }
      }

      if (idParaEditar) await carregarParaEdicao(idParaEditar, contasCarregadas);

      // Renova o catalogo que vai sustentar o formulario na proxima vez que
      // faltar rede. Fica no fim de proposito: salvar antes gravaria um
      // catalogo pela metade se alguma chamada acima falhasse, e meio catalogo
      // e pior que nenhum -- o formulario abriria com meia lista de categorias,
      // sem nada indicando o que falta.
      if (servico?.id && categoriasCarregadas.length > 0) {
        guardarCatalogo(window.localStorage, {
          serviceId: servico.id,
          categorias: categoriasCarregadas.map((c) => ({
            id: c.id,
            name: c.name,
            is_expense: c.is_expense,
          })),
          contas: contasCarregadas.map((c) => ({
            id: c.id,
            name: c.name,
            // `ContaEmCache.account_type` e obrigatorio. String vazia aqui
            // significa "nao e cartao", que e a leitura certa: quem decide a
            // fatura e a comparacao com "credit_card".
            account_type: c.account_type ?? "",
            // A moeda da conta vai para o cache tambem: offline o formulario
            // ainda precisa sugerir a moeda certa, e sem ela toda conta em dolar
            // voltaria a sugerir real assim que a pessoa perdesse o sinal.
            currency: c.currency ?? "",
          })),
          guardadoEm: Date.now(),
        });
        setCatalogoDe(null);
      }
    } catch (erro) {
      console.error("Erro ao carregar o formulário:", erro);
      const catalogo = lerCatalogo(window.localStorage);
      if (catalogo) reporCatalogo(catalogo);
      else avisarAparelhoVazio();
    } finally {
      setCarregando(false);
    }
  };

  /** Traz do banco o lancamento que o `?id=` aponta. */
  const carregarParaEdicao = async (
    id: string,
    contasCarregadas: ContaDeLancamento[]
  ) => {
    const { data: linha, error } = await supabase
      .from("financial_transactions")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !linha) {
      // Sem este aviso a tela abriria em branco com cara de "novo
      // lancamento", e o Salvar criaria uma SEGUNDA linha em vez de editar a
      // que a pessoa clicou.
      toast.error("Não encontrei esse lançamento para editar.");
      return;
    }

    const contaDaLinha = contasCarregadas.find(
      (c) => c.id === linha.account_id
    );

    setEditando(true);
    setValores({
      ...valoresIniciais(),
      descricao: linha.description ?? "",
      valor: Math.abs(Number(linha.amount)).toString(),
      categoriaId: linha.category_id ?? "",
      contaId: linha.account_id ?? "",
      data: linha.transaction_date ?? valoresIniciais().data,
      notas: linha.notes ?? "",
      // Editar nunca cai em "fixa": o que esta gravado e um lancamento, nao uma
      // regra. A regra se edita em Contas Previstas. Aqui so distinguimos se o
      // lancamento saiu de um cartao.
      //
      // O `tipo === "expense"` e o que mantem o seletor coerente: "card" nao
      // esta em `naturezasDoTipo("income")`, e uma receita apontada para um
      // cartao (estorno lancado como entrada, por exemplo) abriria o seletor com
      // um valor que nao e nenhuma das opcoes -- o radix mostra o gatilho VAZIO,
      // como se a tela nao tivesse carregado.
      natureza:
        tipo === "expense" && contaDaLinha?.account_type === "credit_card"
          ? "card"
          : "one_off",
      compartilhado: Boolean(linha.is_shared),
      grupoId: linha.group_id ?? "",
      // A moeda GRAVADA ganha da moeda atual da conta -- e por isso
      // `doLancamento` vem primeiro. Ler a da conta aqui faria a edicao de uma
      // conta que trocou de moeda reabrir todo lancamento antigo dela na moeda
      // NOVA, e o Salvar (sem mexer em nada) converteria o historico na razao de
      // 1 para 1.
      moeda: moedaSugerida({
        doLancamento: linha.currency,
        daConta: contaDaLinha?.currency,
      }),
      // A checkbox aparece MARCADA quando o lancamento esta numa moeda diferente
      // da que a conta dele sugere. E o unico jeito de a tela nao esconder a
      // informacao: desmarcada, o seletor fica invisivel e a pessoa edita um
      // lancamento em dolar sem nada na tela dizendo que ele e em dolar.
      moedaSobreposta:
        moedaSugerida({ doLancamento: linha.currency }) !==
        moedaSugerida({ daConta: contaDaLinha?.currency }),
    });
  };

  /**
   * Lancamento fixo vira uma regra em `recurring_rules`, nao um lancamento. A
   * rota ja materializa a agenda, entao a conta aparece em Contas Previstas no
   * mesmo instante -- e la que ela e dada como paga/recebida mes a mes.
   *
   * Serve as DUAS telas desde a HMO-170: salario e o caso que motivou a issue.
   * O corpo do pedido sai de `regraDeRecorrencia`, que e quem garante o valor
   * positivo e o `transaction_type` vindo do tipo da tela -- um literal
   * "expense" aqui faria o salario nascer como gasto.
   */
  const criarRegraFixa = async () => {
    const resposta = await fetch("/api/recurring-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(regraDeRecorrencia(tipo, valores)),
    });

    const dados = await resposta.json();
    if (!resposta.ok) {
      toast.error(dados.error || copia.erroDaRegra);
      return false;
    }

    toast.success(copia.regraCriada);
    return true;
  };

  const criarParcelas = async () => {
    const resposta = await fetch("/api/financial-installments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: valores.contaId || null,
        category_id: valores.categoriaId,
        description: valores.descricao,
        total_amount:
          Number.parseFloat(valores.valorDaParcela) * valores.totalDeParcelas,
        total_installments: valores.totalDeParcelas,
        first_due_date: valores.primeiroVencimento,
        transaction_type: "expense",
        group_id: valores.grupoId || null,
        group_split_type: valores.grupoId
          ? grupos.find((g) => g.id === valores.grupoId)?.default_split_type ||
            "equal"
          : null,
        notes: valores.notas,
      }),
    });

    const dados = await resposta.json();
    if (!resposta.ok) {
      toast.error(dados.error || "Erro ao criar parcelas");
      return false;
    }

    toast.success(dados.message || "Parcelas criadas.");
    return true;
  };

  /**
   * O erro que chegou foi a rede caindo, ou o servidor recusando?
   *
   * Vale para o caso em que `navigator.onLine` mentiu -- ele so e confiavel
   * quando diz que NAO ha rede. Erramos para o lado de guardar: um lancamento a
   * mais na fila custa uma requisicao, e um a menos custa um gasto que nunca
   * foi anotado.
   */
  const ehFalhaDeRede = (erro: unknown) => {
    const e = erro as { message?: string; code?: string; status?: number };
    if (e?.status === 0) return true;
    if (typeof e?.status === "number" && e.status >= 500) return true;
    // As tres mensagens sao dos tres motores de navegador para a MESMA falha:
    // so a do Safari ("Load failed") nao contem a palavra "fetch".
    return /failed to fetch|networkerror|load failed/i.test(e?.message ?? "");
  };

  /**
   * Manda o lancamento para a fila do aparelho. Devolve `false` quando ele NAO
   * pode esperar a rede -- parcelamento, divisao, despesa fixa e edicao
   * escrevem em varias tabelas, e uma fila que acerta metade erra dinheiro em
   * silencio. O motivo de cada recusa esta em `lib/offline-queue.ts`.
   */
  const guardarOffline = async (mensagemDeSucesso: string) => {
    const categoria = categorias.find((c) => c.id === valores.categoriaId);

    const resultado = await enfileirar({
      // Sem isto a fila grava pelo DEFAULT da coluna, e todo lancamento feito
      // offline numa conta em dolar entra como real na sincronizacao.
      moeda: valores.moeda,
      userId: user?.id ?? "",
      serviceId,
      categoryId: valores.categoriaId,
      accountId: valores.contaId || null,
      descricao: valores.descricao,
      valor: valores.valor,
      tipo,
      categoriaEhDespesa: categoria?.is_expense,
      data: valores.data,
      notas: valores.notas || null,
      parcelado: valores.parcelado,
      compartilhado: valores.compartilhado,
      grupoId: valores.grupoId || null,
      editando,
      // Vai nos DOIS tipos desde a HMO-170. A fila recusa `fixed` porque regra
      // nao e lancamento; enquanto isto era `tipo === "expense" ? ... :
      // undefined`, a receita fixa passava pela peneira como receita PONTUAL --
      // a fila gravaria uma entrada avulsa, e o salario seria contado de novo
      // quando a ocorrencia do mes fosse baixada. Dinheiro em dobro, sem erro.
      tipoDeDespesa: valores.natureza,
    });

    if (resultado.estado === "recusado") {
      // Sem rede, este aviso e o fim da linha para este lancamento -- entao ele
      // precisa dizer o que fazer, nao so que deu errado.
      if (!online) toast.error(resultado.mensagem);
      return false;
    }

    toast.success(mensagemDeSucesso);
    return true;
  };

  const voltarParaLista = () => {
    router.push("/dashboard/personal-finance");
  };

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();

    if (!user) {
      toast.error("Faça login para lançar.");
      return;
    }

    const categoria = categorias.find((c) => c.id === valores.categoriaId);
    const validacao = validarLancamento(tipo, valores, {
      categoria,
      editando,
    });
    if (!validacao.ok) {
      toast.error(validacao.mensagem);
      return;
    }

    setSalvando(true);
    try {
      // Este ramo vem antes do resto de proposito. Offline, a primeira coisa que
      // o caminho normal faz e uma consulta auxiliar -- ou seja, ele falha longe
      // do insert, e o erro que chega nao tem relacao com o lancamento.
      if (!online && !editando) {
        const guardou = await guardarOffline(
          "Sem conexão. Guardei no aparelho e envio quando a rede voltar."
        );
        if (guardou) {
          voltarParaLista();
          return;
        }
      }

      if (campos.diaDeVencimento && valores.natureza === "fixed") {
        if (await criarRegraFixa()) voltarParaLista();
        return;
      }

      if (valores.parcelado && campos.parcelamento) {
        if (await criarParcelas()) voltarParaLista();
        return;
      }

      await gravarTransacao();
      voltarParaLista();
    } catch (erro) {
      console.error("Erro ao gravar lançamento:", erro);

      // A recusa do banco que tem explicacao (HMO-176): editar uma despesa de
      // grupo cuja parte alguem ja aprovou. Vem ANTES da fila offline de
      // proposito -- guardar no aparelho para reenviar depois so adiaria a
      // mesma recusa, e a pessoa levaria o erro duas vezes.
      const travada = avisoDeEdicaoTravada(erro);
      if (travada) {
        toast.error(travada);
        return;
      }

      // O segundo caminho da fila, e o mais traicoeiro: o navegador disse que
      // havia rede e nao havia. Sem este ramo o lancamento morreria aqui com um
      // erro generico, que e a situacao que a fila veio evitar.
      if (!editando && ehFalhaDeRede(erro)) {
        const guardou = await guardarOffline(
          "Sem conexão no meio do envio. Guardei no aparelho."
        );
        if (guardou) {
          voltarParaLista();
          return;
        }
      }

      toast.error("Erro ao gravar o lançamento.");
    } finally {
      setSalvando(false);
    }
  };

  const gravarTransacao = async () => {
    const valor = valorGravado(tipo, Number.parseFloat(valores.valor));
    const temGrupo = Boolean(valores.grupoId);
    const temRateio = valores.compartilhado && valores.rateios.length > 0;

    const linha = {
      category_id: valores.categoriaId,
      account_id: valores.contaId || null,
      description: valores.descricao,
      amount: valor,
      transaction_date: valores.data,
      transaction_type: tipo,
      notes: valores.notas,
      is_shared: Boolean(temGrupo || temRateio),
      group_id: temGrupo ? valores.grupoId : null,
      // A moeda vai SEMPRE, inclusive com a checkbox desmarcada e com o recurso
      // desligado nas configuracoes -- nesses casos ela e a moeda da conta (ou a
      // oficial), nunca vazia. Mandar so quando a checkbox esta marcada faria o
      // lancamento de uma conta em dolar ser gravado em reais pelo DEFAULT da
      // coluna, e o relatorio somaria ele no balde errado sem erro nenhum.
      currency: valores.moeda,
    };

    let transacao: { id: string };

    if (editando && idParaEditar) {
      const { data, error } = await supabase
        .from("financial_transactions")
        .update(linha)
        .eq("id", idParaEditar)
        .eq("user_id", user!.id)
        .select()
        .single();

      if (error) throw error;
      transacao = data;

      await supabase
        .from("expense_splits")
        .delete()
        .eq("transaction_id", idParaEditar);
    } else {
      const { data, error } = await supabase
        .from("financial_transactions")
        .insert({ ...linha, user_id: user!.id, service_id: serviceId })
        .select()
        .single();

      if (error) throw error;
      transacao = data;
    }

    // -----------------------------------------------------------------------
    // GRUPO: QUEM DIVIDE E O BANCO, E ESTA TELA DIZIA QUE TINHA FALHADO
    // -----------------------------------------------------------------------
    // Aqui havia um bloco que criava a linha de `group_transactions` e um
    // `group_expense_splits` por membro ativo. Ele NUNCA funcionou, e o modo
    // como falhava e o pior possivel: dizia a coisa errada com confianca.
    //
    // O banco ja faz exatamente isso em AFTER INSERT de
    // `financial_transactions`, quando a linha tem `group_id` e valor negativo
    // -- inclusive o rateio, corrigido pela 007 para nao perder centavos.
    // Quando o `await` do insert acima retorna, a linha de grupo JA EXISTE.
    //
    // E sao DOIS triggers quase identicos fazendo isso, nao um:
    // `trigger_auto_create_group_transaction` e `trigger_sync_transaction_group`
    // (os dois do 001_baseline). Cada um so age se o outro ainda nao agiu, pelo
    // `IF NOT EXISTS` que ambos tem -- desligar um nao muda nada, o que torna
    // "e so remover o trigger" uma conclusao errada e facil de tirar.
    //
    // Entao o insert que vinha aqui batia sempre na constraint
    // `unique_transaction_per_group`, caia no ramo de erro e mostrava
    //
    //     "Lancei a despesa, mas nao consegui dividir no grupo. Confira em Grupos."
    //
    // em TODA despesa de grupo lancada por esta tela. A divisao estava certa e
    // a pessoa era mandada conferir um estrago que nao existia -- ou, pior,
    // lancava a despesa de novo achando que a primeira nao tinha pegado.
    // Reproduzido num Postgres 17 com a cadeia 001->007: um unico insert em
    // `financial_transactions` com `group_id` produz 1 linha de grupo e 1
    // rateio por membro ativo, e o segundo insert e recusado.
    //
    // `app/api/personal-finance/transactions` ja tinha chegado nessa conclusao
    // e se protege consultando antes de inserir. Esta tela grava direto pelo
    // supabase-js, sem passar por la, e por isso nao herdou a protecao.
    //
    // Uma diferenca fica registrada: o trigger exige `amount < 0`, entao uma
    // despesa de valor ZERO nao vira linha de grupo. O bloco antigo criava --
    // um rateio de R$ 0,00 por cabeca, que a view do 008 conta como despesa de
    // gasto zero. Nao vale um caminho de escrita paralelo para sustentar isso.

    // Rateio com conexoes individuais (fora de grupo).
    if (temRateio && !temGrupo) {
      const { error } = await supabase.from("expense_splits").insert(
        valores.rateios.map((rateio) => ({
          transaction_id: transacao.id,
          participant_id: rateio.participanteId,
          percentage: rateio.percentual,
          amount: Math.abs(valor) * (rateio.percentual / 100),
          status: "pending",
        }))
      );

      if (error) throw error;
    }

    toast.success(editando ? copia.atualizado : copia.salvo);
  };

  const percentualUsado = valores.rateios.reduce(
    (soma, r) => soma + r.percentual,
    0
  );

  const adicionarRateio = (participanteId: string) => {
    if (valores.rateios.find((r) => r.participanteId === participanteId)) return;
    aoMudar({
      rateios: [
        ...valores.rateios,
        {
          participanteId,
          percentual: Math.min(100 - percentualUsado, 50),
        },
      ],
    });
  };

  if (carregando) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const Icone = tipo === "expense" ? TrendingDown : TrendingUp;

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
          <Icone
            className={`h-7 w-7 ${
              tipo === "expense" ? "text-destructive" : "text-success"
            }`}
          />
          {editando
            ? tipo === "expense"
              ? "Editar despesa"
              : "Editar receita"
            : copia.titulo}
        </h1>
        <p className="text-muted-foreground">{copia.descricao}</p>
        {catalogoDe !== null && (
          <p className="text-sm text-warning">
            Sem conexão. As categorias e contas são as de{" "}
            {new Date(catalogoDe).toLocaleString("pt-BR")}.
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{editando ? "Dados do lançamento" : copia.titulo}</CardTitle>
          <CardDescription>
            Campos com * são obrigatórios.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={enviar} className="space-y-6">
            <CamposDeLancamento
              tipo={tipo}
              valores={valores}
              aoMudar={aoMudar}
              categorias={categorias}
              contas={contas}
              editando={editando}
              moedaPorLancamento={preferenciaDeMoeda.porLancamento}
              moedaOficial={preferenciaDeMoeda.oficial}
              rateio={
                <SoftFeatureGuard feature="expense_groups" user={user}>
                  <div className="space-y-4 p-4 border rounded-lg bg-muted/20">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="is_shared"
                        checked={valores.compartilhado || Boolean(valores.grupoId)}
                        onChange={(e) =>
                          aoMudar({
                            compartilhado: e.target.checked,
                            rateios: e.target.checked ? valores.rateios : [],
                            grupoId: e.target.checked ? valores.grupoId : "",
                          })
                        }
                      />
                      <Label htmlFor="is_shared" className="font-medium">
                        Dividir esta despesa
                      </Label>
                    </div>

                    {(valores.compartilhado || Boolean(valores.grupoId)) && (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>Dividir com grupo</Label>
                          <Select
                            value={valores.grupoId || "none"}
                            onValueChange={(value: string) =>
                              aoMudar({
                                grupoId: value === "none" ? "" : value,
                                // Grupo e rateio individual sao exclusivos: o
                                // grupo ja tem a lista de quem paga.
                                rateios:
                                  value === "none" ? valores.rateios : [],
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione um grupo" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Nenhum grupo</SelectItem>
                              {grupos.map((grupo) => (
                                <SelectItem key={grupo.id} value={grupo.id}>
                                  <div className="flex items-center gap-2">
                                    <Users className="h-4 w-4" />
                                    {grupo.name}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {!valores.grupoId && (
                          <div className="space-y-3">
                            <Label>
                              Divisão com conexões ({percentualUsado}% usado)
                            </Label>

                            {valores.rateios.map((rateio) => {
                              const conexao = conexoes.find(
                                (c) => c.id === rateio.participanteId
                              );
                              return (
                                <div
                                  key={rateio.participanteId}
                                  className="flex flex-wrap items-center gap-3 p-3 border rounded"
                                >
                                  <Avatar className="h-8 w-8">
                                    <AvatarImage src={conexao?.avatar_url} />
                                    <AvatarFallback>
                                      {conexao?.full_name?.charAt(0)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="flex-1">
                                    {conexao?.full_name}
                                  </span>
                                  <Input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={rateio.percentual}
                                    onChange={(e) =>
                                      aoMudar({
                                        rateios: valores.rateios.map((r) =>
                                          r.participanteId ===
                                          rateio.participanteId
                                            ? {
                                                ...r,
                                                percentual: Number(
                                                  e.target.value
                                                ),
                                              }
                                            : r
                                        ),
                                      })
                                    }
                                    className="w-20"
                                  />
                                  <span>%</span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      aoMudar({
                                        rateios: valores.rateios.filter(
                                          (r) =>
                                            r.participanteId !==
                                            rateio.participanteId
                                        ),
                                      })
                                    }
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              );
                            })}

                            {percentualUsado < 100 && (
                              <Select onValueChange={adicionarRateio}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Adicionar pessoa" />
                                </SelectTrigger>
                                <SelectContent>
                                  {conexoes
                                    .filter(
                                      (c) =>
                                        !valores.rateios.find(
                                          (r) => r.participanteId === c.id
                                        )
                                    )
                                    .map((conexao) => (
                                      <SelectItem
                                        key={conexao.id}
                                        value={conexao.id}
                                      >
                                        {conexao.full_name}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            )}

                            {valores.rateios.length > 0 &&
                              percentualUsado !== 100 && (
                                <p className="text-sm text-warning">
                                  Restam {100 - percentualUsado}% para
                                  distribuir
                                </p>
                              )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </SoftFeatureGuard>
              }
            />

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={salvando}>
                {editando ? "Atualizar" : copia.salvar}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/dashboard/personal-finance">Cancelar</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
