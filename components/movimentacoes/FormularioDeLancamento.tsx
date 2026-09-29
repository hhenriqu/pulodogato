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
import { useOfflineQueue } from "@/lib/hooks/useOfflineQueue";
import {
  camposDoTipo,
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
    descricao: "Dinheiro que entrou: salário, venda, rendimento, reembolso.",
    salvar: "Salvar receita",
    salvo: "Receita lançada.",
    atualizado: "Receita atualizada.",
  },
  expense: {
    titulo: "Nova Despesa",
    descricao:
      "Dinheiro que saiu. Pode ser pontual, no cartão, fixa mensal ou parcelada.",
    salvar: "Salvar despesa",
    salvo: "Despesa lançada.",
    atualizado: "Despesa atualizada.",
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
      natureza: contaDaLinha?.account_type === "credit_card" ? "card" : "one_off",
      compartilhado: Boolean(linha.is_shared),
      grupoId: linha.group_id ?? "",
    });
  };

  /**
   * Despesa fixa vira uma regra em `recurring_rules`, nao um lancamento. A rota
   * ja materializa a agenda, entao a conta aparece em Contas Previstas no mesmo
   * instante -- e la que ela e dada como paga mes a mes.
   */
  const criarDespesaFixa = async () => {
    const resposta = await fetch("/api/recurring-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: valores.descricao,
        // A rota espera o valor positivo: quem aplica o sinal de despesa e a
        // baixa da ocorrencia, nao a regra.
        amount: Math.abs(Number.parseFloat(valores.valor)),
        category_id: valores.categoriaId,
        account_id: valores.contaId || null,
        transaction_type: "expense",
        frequency: "monthly",
        due_day: Number(valores.diaDeVencimento),
        start_date: valores.data,
        notes: valores.notas || null,
        group_id: valores.grupoId || null,
      }),
    });

    const dados = await resposta.json();
    if (!resposta.ok) {
      toast.error(dados.error || "Erro ao criar a despesa fixa");
      return false;
    }

    toast.success("Despesa fixa criada. Ela aparece em Contas Previstas.");
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
      tipoDeDespesa: tipo === "expense" ? valores.natureza : undefined,
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
        if (await criarDespesaFixa()) voltarParaLista();
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

    // Grupo: a despesa vira uma linha de grupo com um split por membro ativo.
    if (temGrupo && tipo === "expense") {
      const { data: transacaoDeGrupo, error: erroDeGrupo } = await supabase
        .from("group_transactions")
        .insert({
          group_id: valores.grupoId,
          transaction_id: transacao.id,
          split_type: "equal",
        })
        .select()
        .single();

      if (erroDeGrupo) {
        // A despesa esta gravada; o que falhou e o rateio. Dizer isso e melhor
        // que um sucesso limpo que esconde metade.
        console.error("Erro ao criar group_transaction:", erroDeGrupo);
        toast.error(
          "Lancei a despesa, mas não consegui dividir no grupo. Confira em Grupos."
        );
      } else {
        const { data: membros } = await supabase
          .from("group_members")
          .select("id")
          .eq("group_id", valores.grupoId)
          .eq("status", "active");

        if (membros && membros.length > 0) {
          const porMembro = Math.abs(valor) / membros.length;
          const { error: erroDeSplits } = await supabase
            .from("group_expense_splits")
            .insert(
              membros.map((membro: { id: string }) => ({
                group_transaction_id: transacaoDeGrupo.id,
                member_id: membro.id,
                percentage: 100 / membros.length,
                amount: porMembro,
                status: "pending",
              }))
            );

          if (erroDeSplits) {
            console.error("Erro ao criar group splits:", erroDeSplits);
            toast.error(
              "Lancei a despesa, mas o rateio do grupo não foi gravado."
            );
          }
        }
      }
    }

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
