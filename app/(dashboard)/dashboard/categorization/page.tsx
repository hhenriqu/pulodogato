"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tags, Plus, Power, Trash2, Sparkles, Hand, Wand2 } from "lucide-react";

// =====================================================
// Regras de categorizacao (HMO-145)
// =====================================================
// A tela existe para uma pergunta: "quanto trabalho manual isto ja me poupou?"
// Por isso o numero grande no topo e o TOTAL DE LANCAMENTOS CATEGORIZADOS
// sozinho, e nao a contagem de regras. Uma lista de configuracao sem resultado
// visivel e uma tela que o usuario visita uma vez e nunca mais.
//
// A ordem da lista e por uso, da regra que mais trabalhou para a que menos --
// e nao alfabetica. Quem abre esta tela quer ver o que esta funcionando, e a
// regra que nunca pegou nada e justamente a que precisa de atencao, no fim.
//
// DE ONDE VEM UMA REGRA
// ---------------------
// Das duas maneiras, e a tela distingue as duas com a etiqueta de origem:
//   - aprendida: o app gravou a categoria que o usuario escolheu ao importar
//   - manual:    ele cadastrou aqui, ou corrigiu uma aprendida
// A distincao nao e decorativa. O aprendizado nunca sobrescreve uma regra
// manual, entao a etiqueta responde "por que esta regra nao mudou sozinha".
//
// Toda cor sai de token (bg-card, text-muted-foreground, bg-warning/10...).
// Uma classe de paleta fixa do Tailwind passa no build e vira um bloco claro
// no modo noturno -- o `npm run check-color-tokens` reprova, ver HMO-144.
//
// (O proprio guard nao mascara comentario: citar aqui o nome de uma dessas
// classes, ainda que para explicar por que nao usa-la, reprova o commit.)
// =====================================================

interface Categoria {
  id: string;
  name: string;
  icon: string | null;
  color_hex: string | null;
  is_expense: boolean;
}

interface Regra {
  id: string;
  merchant_key: string;
  display_name: string;
  category_id: string;
  source: "manual" | "learned";
  is_active: boolean;
  times_applied: number;
  last_applied_at: string | null;
  transaction_categories: Categoria | null;
}

function formatarData(iso: string | null): string {
  if (!iso) return "nunca";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

export default function CategorizationPage() {
  const [regras, setRegras] = useState<Regra[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [totalAplicado, setTotalAplicado] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [novoTexto, setNovoTexto] = useState("");
  const [novaCategoria, setNovaCategoria] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [respRegras, respCategorias] = await Promise.all([
        fetch("/api/categorization-rules"),
        fetch("/api/personal-finance/categories"),
      ]);

      if (!respRegras.ok) {
        const corpo = await respRegras.json().catch(() => ({}));
        throw new Error(corpo.error || "Não foi possível carregar as regras");
      }

      const dados = await respRegras.json();
      setRegras(dados.rules ?? []);
      setTotalAplicado(Number(dados.total_applied ?? 0));

      if (respCategorias.ok) {
        const c = await respCategorias.json();
        setCategorias(c.categories ?? c ?? []);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function criar() {
    if (!novoTexto.trim() || !novaCategoria) return;
    setSalvando(true);
    setErro(null);
    try {
      const resp = await fetch("/api/categorization-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: novoTexto, category_id: novaCategoria }),
      });

      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.error || "Não foi possível salvar a regra");
      }

      setNovoTexto("");
      setNovaCategoria("");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  async function alterar(id: string, patch: Record<string, unknown>) {
    setErro(null);
    try {
      const resp = await fetch(`/api/categorization-rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.error || "Não foi possível atualizar");
      }
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao atualizar");
    }
  }

  async function apagar(id: string) {
    setErro(null);
    try {
      const resp = await fetch(`/api/categorization-rules/${id}`, { method: "DELETE" });
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.error || "Não foi possível apagar");
      }
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao apagar");
    }
  }

  const ativas = regras.filter((r) => r.is_active).length;

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="flex items-center gap-3">
        <Tags className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Regras de categorização</h1>
          <p className="text-muted-foreground text-sm">
            Diga uma vez o que é cada estabelecimento. A próxima cobrança dele já entra
            categorizada sozinha.
          </p>
        </div>
      </div>

      {erro && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {erro}
        </div>
      )}

      {/* O numero que responde "isto vale a pena". Ver o cabecalho. */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Lançamentos categorizados sozinho</CardDescription>
            <CardTitle className="text-3xl">{totalAplicado}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-xs">
              Escolhas que você não precisou fazer na importação.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Regras ativas</CardDescription>
            <CardTitle className="text-3xl">{ativas}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-xs">
              {regras.length - ativas > 0
                ? `${regras.length - ativas} desligada(s), que continuam guardadas.`
                : "Nenhuma desligada."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sem regra? Ainda há palpite</CardDescription>
            <CardTitle className="text-lg">Catálogo embutido</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-xs">
              Lojistas conhecidos (iFood, Uber, Netflix...) aparecem sugeridos na tela de
              importação — mas só viram categoria se você aceitar.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* --- cadastro manual --- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" />
            Nova regra
          </CardTitle>
          <CardDescription>
            Cole o texto como ele aparece no extrato — inclusive com os códigos do banco.
            O app reconhece as outras variações do mesmo estabelecimento sozinho.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row">
          <input
            className="border-input bg-background flex-1 rounded-md border px-3 py-2 text-sm"
            placeholder="IFD*IFOOD 3947"
            value={novoTexto}
            onChange={(e) => setNovoTexto(e.target.value)}
          />
          <select
            className="border-input bg-background rounded-md border px-3 py-2 text-sm"
            value={novaCategoria}
            onChange={(e) => setNovaCategoria(e.target.value)}
          >
            <option value="">Escolha a categoria</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.is_expense ? "(despesa)" : "(receita)"}
              </option>
            ))}
          </select>
          <Button onClick={criar} disabled={salvando || !novoTexto.trim() || !novaCategoria}>
            {salvando ? "Salvando..." : "Criar regra"}
          </Button>
        </CardContent>
      </Card>

      {/* --- a lista --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Suas regras</CardTitle>
          <CardDescription>Da que mais trabalhou para a que menos.</CardDescription>
        </CardHeader>
        <CardContent>
          {carregando ? (
            <p className="text-muted-foreground py-8 text-center text-sm">Carregando...</p>
          ) : regras.length === 0 ? (
            <div className="py-10 text-center">
              <Wand2 className="text-muted-foreground mx-auto mb-3 h-8 w-8" />
              <p className="text-sm font-medium">Nenhuma regra ainda.</p>
              <p className="text-muted-foreground mx-auto mt-1 max-w-md text-xs">
                Você não precisa cadastrar nada: basta importar um extrato e escolher a
                categoria de um lançamento. O app guarda a escolha e aplica sozinho da
                próxima vez.
              </p>
            </div>
          ) : (
            <div className="divide-border divide-y">
              {regras.map((r) => (
                <div
                  key={r.id}
                  className={`flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between ${
                    r.is_active ? "" : "opacity-60"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{r.display_name}</span>

                      {r.source === "learned" ? (
                        <Badge variant="secondary" className="gap-1">
                          <Sparkles className="h-3 w-3" />
                          Aprendida
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <Hand className="h-3 w-3" />
                          Sua
                        </Badge>
                      )}

                      {!r.is_active && <Badge variant="outline">Desligada</Badge>}
                    </div>

                    <p className="text-muted-foreground mt-1 text-xs">
                      {/* A chave normalizada aparece de proposito: e o que
                          explica por que a regra pega "PAG*IFOOD" tambem. Sem
                          mostra-la, o casamento vira magica inexplicavel. */}
                      reconhece <code className="bg-muted rounded px-1">{r.merchant_key}</code>
                      {" · "}
                      {r.times_applied === 0
                        ? "ainda não pegou nenhum lançamento"
                        : `${r.times_applied} lançamento(s) · última vez ${formatarData(
                            r.last_applied_at
                          )}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      className="border-input bg-background rounded-md border px-2 py-1.5 text-sm"
                      value={r.category_id}
                      onChange={(e) => alterar(r.id, { category_id: e.target.value })}
                    >
                      {categorias.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => alterar(r.id, { is_active: !r.is_active })}
                      title={
                        r.is_active
                          ? "Desligar: para de aplicar, mas o app não volta a aprender esta regra sozinho"
                          : "Religar"
                      }
                    >
                      <Power className="h-4 w-4" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => apagar(r.id)}
                      title="Apagar de vez. Os lançamentos já categorizados continuam como estão."
                    >
                      <Trash2 className="text-destructive h-4 w-4" />
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
