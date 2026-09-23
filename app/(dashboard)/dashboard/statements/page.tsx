"use client";

// Importacao de extrato do banco (OFX/CSV) com conciliacao.
//
// A tela tem uma ordem deliberada: primeiro o que ainda espera decisao, depois
// o envio de um arquivo novo, e so no fim o historico. Quem abre aqui na
// segunda vez vem terminar o que comecou, nao mandar outro arquivo.
//
// O QUE ESTA TELA NAO FAZ SOZINHA
// --------------------------------
// Nenhuma linha vira lancamento sem um clique. A conciliacao e uma SUGESTAO
// mostrada lado a lado com o que ela encontrou -- o usuario ve "casou com
// 'Mercado' de 10/09, mesmo valor" e decide. Conciliacao automatica erra em
// silencio, e o erro dela e apagar do app um gasto que aconteceu de verdade.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  FileUp,
  Link2,
  Loader2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { FinancialAccount, TransactionCategory } from "@/types/financial";

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);

// 'YYYY-MM-DD' formatado sem passar por new Date(): a string ISO e lida como
// UTC e, no Brasil, voltaria um dia no fuso local.
const dataCurta = (iso: string | null) => {
  if (!iso) return "--";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano.slice(2)}`;
};

interface StatementImport {
  id: string;
  account_id: string;
  file_name: string;
  file_format: "ofx" | "csv";
  period_start: string | null;
  period_end: string | null;
  entry_count: number;
  duplicate_count: number;
  created_at: string;
  pending_count: number;
  account: { name: string; color_hex?: string } | null;
}

interface Sugestao {
  transaction: { id: string; description: string; amount: number; transaction_date: string } | null;
  day_gap: number;
  similarity: number;
}

interface StatementEntry {
  id: string;
  fingerprint: string;
  posted_at: string;
  amount: number;
  description: string;
  memo: string | null;
  status: "pending" | "imported" | "linked" | "ignored";
  transaction_id: string | null;
  suggestion: Sugestao | null;
  category_suggestion: SugestaoCategoria | null;
}

// A categoria sugerida para a linha. `origin` distingue a REGRA do usuario
// ("voce ja disse que isto e X") do palpite do catalogo ("acho que e X"), e a
// tela precisa tratar as duas diferente -- ver o rotulo mais abaixo.
interface SugestaoCategoria {
  category_id: string;
  category_name: string;
  origin: "rule" | "catalog";
  matched_key: string;
}

export default function StatementsPage() {
  const [imports, setImports] = useState<StatementImport[]>([]);
  const [contas, setContas] = useState<FinancialAccount[]>([]);
  const [categorias, setCategorias] = useState<TransactionCategory[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [contaEscolhida, setContaEscolhida] = useState("");
  const [enviando, setEnviando] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<StatementEntry[]>([]);
  const [carregandoLinhas, setCarregandoLinhas] = useState(false);
  const [categoriaPorLinha, setCategoriaPorLinha] = useState<Record<string, string>>({});
  const [agindoEm, setAgindoEm] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);

  const carregarBase = useCallback(async () => {
    try {
      const [rExtratos, rContas, rCategorias] = await Promise.all([
        fetch("/api/statements"),
        fetch("/api/financial-accounts"),
        fetch("/api/personal-finance/categories"),
      ]);

      const extratos = await rExtratos.json();
      if (rExtratos.ok) setImports(extratos.imports ?? []);

      const dadosContas = await rContas.json();
      if (rContas.ok) setContas(dadosContas.accounts ?? dadosContas.data ?? []);

      const dadosCategorias = await rCategorias.json();
      if (rCategorias.ok) setCategorias(dadosCategorias.categories ?? dadosCategorias.data ?? []);
    } catch {
      toast.error("Não foi possível carregar a tela");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregarBase();
  }, [carregarBase]);

  // -------------------------------------------------------------------
  // Varredura de assinaturas depois de mexer no extrato
  // -------------------------------------------------------------------
  // Importar extrato e o momento em que aparece a cobranca que o detector de
  // assinaturas procura. Sem este gatilho, a tela /dashboard/recurrences so
  // muda quando o usuario lembra de clicar em "Procurar agora" -- e quem nao
  // sabe que o botao existe nunca ve assinatura nenhuma.
  //
  // UMA varredura por SESSAO de importacao, e nao uma por linha. Quem processa
  // 40 linhas de um OFX dispararia 40 varreduras de 24 meses de historico, cada
  // uma reescrevendo o resultado da anterior. Por isso o clique so levanta uma
  // bandeira; a varredura sai quando o usuario fecha o extrato ou deixa a tela.
  //
  // E fire-and-forget de proposito: a varredura e idempotente e o cron diario
  // passa de qualquer jeito, entao uma falha aqui nao tem o que informar ao
  // usuario -- e um toast de erro sobre um job que ele nao pediu so assustaria.
  const extratoMexido = useRef(false);

  const varrerSeMexeu = useCallback(() => {
    if (!extratoMexido.current) return;
    extratoMexido.current = false;
    fetch("/api/recurrences/scan", { method: "POST" }).catch(() => {});
  }, []);

  // Sair da tela sem fechar o extrato e o caminho mais comum. Sem esta limpeza,
  // a bandeira morreria junto com o componente e a lista de assinaturas so
  // andaria no dia seguinte, pelo cron.
  useEffect(() => varrerSeMexeu, [varrerSeMexeu]);

  const fecharExtrato = useCallback(() => {
    setAbertoId(null);
    varrerSeMexeu();
  }, [varrerSeMexeu]);

  const abrirExtrato = useCallback(async (id: string) => {
    setAbertoId(id);
    setCarregandoLinhas(true);
    try {
      const r = await fetch(`/api/statements/${id}`);
      const dados = await r.json().catch(() => ({}));

      if (!r.ok) {
        toast.error(dados.error ?? "Não foi possível abrir o extrato");
        setAbertoId(null);
        return;
      }

      const entradas: StatementEntry[] = dados.entries ?? [];
      setLinhas(entradas);

      // O seletor ja abre preenchido com a sugestao. E aqui que a feature
      // aparece para quem usa: em vez de dezenas de escolhas, o usuario percorre
      // a lista clicando "Lançar".
      //
      // Preenche, mas NAO lanca sozinho -- nem quando a sugestao vem de uma
      // regra. A linha do extrato e a ultima chance de olhar para o gasto antes
      // de ele virar dinheiro no app; importar em massa sem ninguem ver
      // transformaria um erro de regra em dezenas de lancamentos errados
      // descobertos so no relatorio do mes.
      //
      // `(m) => ({ ...m, ...novas })` e nao substituicao: o usuario pode ter
      // aberto outro extrato antes e mexido em linhas de la.
      const novas: Record<string, string> = {};
      for (const linha of entradas) {
        if (linha.status === "pending" && linha.category_suggestion) {
          novas[linha.id] = linha.category_suggestion.category_id;
        }
      }
      setCategoriaPorLinha((m) => ({ ...m, ...novas }));
    } finally {
      setCarregandoLinhas(false);
    }
  }, []);

  const enviarArquivo = async (arquivo: File) => {
    if (!contaEscolhida) {
      toast.error("Escolha primeiro a conta deste extrato");
      return;
    }

    setEnviando(true);
    setAvisos([]);
    try {
      // O arquivo e lido como texto no navegador: extrato e texto puro, e assim
      // nada precisa passar por armazenamento de arquivo.
      const conteudo = await arquivo.text();
      const r = await fetch("/api/statements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: contaEscolhida, fileName: arquivo.name, content: conteudo }),
      });
      const dados = await r.json().catch(() => ({}));

      // Os avisos do parser valem mesmo quando o import falha: e ali que esta
      // "nenhuma linha legivel, confira o separador".
      setAvisos(dados.warnings ?? []);

      if (!r.ok) {
        toast.error(dados.error ?? "Falha ao importar");
        return;
      }

      toast.success(
        dados.duplicates > 0
          ? `${dados.inserted} lançamento(s) novo(s). ${dados.duplicates} já estavam importados.`
          : `${dados.inserted} lançamento(s) para revisar.`
      );

      await carregarBase();
      if (dados.inserted > 0) await abrirExtrato(dados.import.id);
    } finally {
      setEnviando(false);
      if (inputArquivo.current) inputArquivo.current.value = "";
    }
  };

  const agir = async (linha: StatementEntry, action: string, extra: Record<string, string> = {}) => {
    setAgindoEm(linha.id);
    try {
      const r = await fetch(`/api/statements/entries/${linha.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const dados = await r.json().catch(() => ({}));

      if (!r.ok) {
        toast.error(dados.error ?? "Não foi possível concluir");
        return;
      }

      // So `import` e `reset` mexem no conjunto de lancamentos que o detector
      // le -- um cria a financial_transaction, o outro apaga a que tinha sido
      // criada. `link` aponta para lancamento que ja existia e `ignore` nao
      // toca em nada: varrer depois deles seria trabalho garantidamente inutil.
      if (action === "import" || action === "reset") extratoMexido.current = true;

      // A regra nasceu escondida atras de um "Lançar". Se o app nao contar
      // agora, o usuario nunca vai saber que ela existe -- e vai continuar
      // achando que escolhe a categoria toda vez porque nao ha alternativa.
      if (dados.rule_learned) {
        toast.info("Guardei essa categoria: a próxima cobrança deste lugar já vem preenchida.");
      }

      if (dados.aviso) toast.info(dados.aviso);
      else
        toast.success(
          action === "import"
            ? "Lançamento criado"
            : action === "link"
              ? "Vinculado ao lançamento que já existia"
              : action === "ignore"
                ? "Linha ignorada"
                : "Desfeito"
        );

      if (abertoId) await abrirExtrato(abertoId);
      await carregarBase();
    } finally {
      setAgindoEm(null);
    }
  };

  const descartar = async (id: string) => {
    const r = await fetch(`/api/statements/${id}`, { method: "DELETE" });
    const dados = await r.json().catch(() => ({}));

    if (!r.ok) {
      toast.error(dados.error ?? "Não foi possível descartar");
      return;
    }

    toast.success("Extrato descartado");
    // Descartar o extrato NAO apaga as financial_transactions ja criadas a
    // partir dele (ver o comentario do DELETE em /api/statements/[id]), entao a
    // bandeira levantada pelos imports continua valendo e a varredura sai aqui.
    if (abertoId === id) fecharExtrato();
    else varrerSeMexeu();
    await carregarBase();
  };

  const pendentes = useMemo(() => linhas.filter((l) => l.status === "pending"), [linhas]);
  const resolvidas = useMemo(() => linhas.filter((l) => l.status !== "pending"), [linhas]);
  const totalPendente = useMemo(
    () => imports.reduce((s, i) => s + i.pending_count, 0),
    [imports]
  );

  // Despesa e receita tem listas de categoria diferentes: oferecer "Salario"
  // para um debito faria o relatorio por categoria mentir.
  const categoriasPara = (valor: number) =>
    categorias.filter((c) => (valor < 0 ? c.is_expense : !c.is_expense));

  if (carregando) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Importar extrato</h1>
        <p className="text-muted-foreground">
          Mande o OFX ou CSV do banco. O app separa o que já está lançado do que é novo —
          nada entra sem você confirmar.
        </p>
      </div>

      {totalPendente > 0 && !abertoId && (
        <Card className="border-warning/30 bg-warning/10">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            <p className="text-sm">
              <strong>{totalPendente}</strong> lançamento(s) de extrato esperando sua decisão.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ---------------- envio ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileUp className="h-5 w-5" /> Novo extrato
          </CardTitle>
          <CardDescription>
            A conta precisa ser escolhida antes: é por ela que o app sabe com quais lançamentos
            comparar, e é por ela que um arquivo repetido é reconhecido.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Conta</Label>
              <Select value={contaEscolhida} onValueChange={setContaEscolhida}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha a conta" />
                </SelectTrigger>
                <SelectContent>
                  {contas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Arquivo</Label>
              <Input
                ref={inputArquivo}
                type="file"
                accept=".ofx,.csv,.txt,text/csv,application/x-ofx"
                disabled={!contaEscolhida || enviando}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) enviarArquivo(f);
                }}
              />
            </div>
          </div>

          {enviando && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Lendo o arquivo...
            </p>
          )}

          {avisos.length > 0 && (
            <div className="space-y-2 rounded-md border border-warning/30 bg-warning/10 p-3">
              {avisos.map((a, i) => (
                <p key={i} className="flex gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                  {a}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------- revisao ---------------- */}
      {abertoId && (
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-lg">Revisar</CardTitle>
              <CardDescription>
                {pendentes.length} esperando decisão · {resolvidas.length} já resolvido(s)
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={fecharExtrato}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {carregandoLinhas && (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!carregandoLinhas && pendentes.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Tudo deste extrato já foi resolvido.
              </p>
            )}

            {pendentes.map((linha) => {
              const despesa = Number(linha.amount) < 0;
              const ocupado = agindoEm === linha.id;

              return (
                <div key={linha.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{linha.description}</p>
                      <p className="text-sm text-muted-foreground">
                        {dataCurta(linha.posted_at)}
                        {linha.memo ? ` · ${linha.memo}` : ""}
                      </p>
                    </div>
                    <p
                      className={`shrink-0 font-semibold tabular-nums ${
                        despesa ? "text-destructive" : "text-success"
                      }`}
                    >
                      {moeda(Number(linha.amount))}
                    </p>
                  </div>

                  {/* A sugestao da conciliacao, com o que ela encontrou a vista.
                      Sem mostrar COM O QUE casou, confirmar e um voto de fe. */}
                  {linha.suggestion?.transaction && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-muted/60 p-2 text-sm">
                      <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="text-muted-foreground">Parece já lançado como</span>
                      <strong>{linha.suggestion.transaction.description}</strong>
                      <span className="text-muted-foreground">
                        em {dataCurta(linha.suggestion.transaction.transaction_date)}
                        {linha.suggestion.day_gap > 0
                          ? ` (${linha.suggestion.day_gap} dia${linha.suggestion.day_gap > 1 ? "s" : ""} de diferença)`
                          : " (mesmo dia)"}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={ocupado}
                        onClick={() =>
                          agir(linha, "link", {
                            transaction_id: linha.suggestion!.transaction!.id,
                          })
                        }
                      >
                        {ocupado ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="mr-1 h-3 w-3" />
                        )}
                        É o mesmo
                      </Button>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div className="min-w-[180px] flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Label className="text-xs">Categoria</Label>
                        {/* Regra e catalogo NAO podem ter a mesma cara. A regra
                            e uma decisao que o usuario ja tomou; o catalogo e
                            palpite nosso. Apresentar os dois igual ensinaria
                            ele a confiar no chute tanto quanto na propria
                            escolha -- e e o chute que erra. */}
                        {linha.category_suggestion?.origin === "rule" && (
                          <span className="text-primary text-[11px] font-medium">
                            sua regra: {linha.category_suggestion.matched_key}
                          </span>
                        )}
                        {linha.category_suggestion?.origin === "catalog" && (
                          <span className="text-muted-foreground text-[11px]">
                            sugestão — confira
                          </span>
                        )}
                      </div>
                      <Select
                        value={categoriaPorLinha[linha.id] ?? ""}
                        onValueChange={(v) =>
                          setCategoriaPorLinha((m) => ({ ...m, [linha.id]: v }))
                        }
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Escolha para lançar" />
                        </SelectTrigger>
                        <SelectContent>
                          {categoriasPara(Number(linha.amount)).map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <Button
                      size="sm"
                      disabled={ocupado || !categoriaPorLinha[linha.id]}
                      onClick={() =>
                        agir(linha, "import", { category_id: categoriaPorLinha[linha.id] })
                      }
                    >
                      {ocupado ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowRight className="mr-1 h-4 w-4" />
                      )}
                      Lançar
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ocupado}
                      onClick={() => agir(linha, "ignore")}
                    >
                      Ignorar
                    </Button>
                  </div>
                </div>
              );
            })}

            {resolvidas.length > 0 && (
              <details className="pt-2">
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  {resolvidas.length} linha(s) já resolvida(s)
                </summary>
                <div className="mt-2 space-y-2">
                  {resolvidas.map((linha) => (
                    <div
                      key={linha.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <span className="truncate">
                        {dataCurta(linha.posted_at)} · {linha.description}
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {linha.status === "imported"
                            ? "lançada"
                            : linha.status === "linked"
                              ? "já existia"
                              : "ignorada"}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => agir(linha, "reset")}
                          disabled={agindoEm === linha.id}
                        >
                          Desfazer
                        </Button>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------------- historico ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Extratos enviados</CardTitle>
        </CardHeader>
        <CardContent>
          {imports.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum extrato ainda. Exporte o OFX do seu banco — quase todos oferecem,
              às vezes com o nome &quot;Money&quot; ou &quot;Microsoft Money&quot;.
            </p>
          ) : (
            <div className="space-y-2">
              {imports.map((i) => (
                <div
                  key={i.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{i.file_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {i.account?.name ?? "conta removida"} ·{" "}
                      {i.period_start ? `${dataCurta(i.period_start)} a ${dataCurta(i.period_end)}` : "sem período"}{" "}
                      · {i.entry_count} novo(s)
                      {i.duplicate_count > 0 ? ` · ${i.duplicate_count} repetido(s)` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {i.pending_count > 0 && (
                      <Badge variant="destructive">{i.pending_count} pendente(s)</Badge>
                    )}
                    <Button size="sm" variant="outline" onClick={() => abrirExtrato(i.id)}>
                      <Upload className="mr-1 h-3 w-3 rotate-180" /> Revisar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => descartar(i.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
