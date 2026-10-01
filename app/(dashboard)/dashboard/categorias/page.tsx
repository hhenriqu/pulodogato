"use client";

// ---------------------------------------------------------------------------
// GERENCIAR CATEGORIAS (HMO-216)
// ---------------------------------------------------------------------------
// "Todas as categorias devem poder ser personalizadas pelo usuario."
//
// TODAS inclui as 13 do catalogo, e e dai que vem a unica coisa que esta tela
// tem de deixar clara: ha DOIS tipos de linha aqui, com poderes diferentes, e
// confundi-los produz uma tela que mente.
//
//   categoria DELA        -> renomeia, muda cor, exclui (ou desativa, se tiver
//                            lancamento apontando para ela)
//   categoria do CATALOGO -> renomeia e muda cor SO PARA ELA, e esconde.
//                            Nao da para excluir: a linha e dos outros
//                            usuarios tambem.
//
// A tela nao esconde essa diferenca atras de botoes iguais -- ela a DIZ, no
// badge de cada linha e no texto do botao. Esconder produziria a pior versao
// deste ecra: "Excluir" numa categoria do catalogo, que ou falharia com 42501
// ou (pior) apagaria a categoria de todo mundo.
//
// Quem decide qual dos dois caminhos a escrita toma e o SERVIDOR, nao esta
// tela: `PATCH /api/personal-finance/categories/[id]` compara o `user_id` da
// linha com o da sessao e escolhe entre UPDATE e preferencia. Aqui so se
// mostra o resultado -- e e por isso que um unico handler atende os dois tipos.
//
// A SUBCATEGORIA tem gestao propria dentro de cada linha, expandindo. Uma
// segunda tela para ela separaria "Alimentação" de "Mercado dentro de
// Alimentação", que e a unica relacao que importa aqui.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Plus,
  Tag,
  Trash2,
} from "lucide-react";
import {
  categoriaEfetiva,
  subcategoriasDaCategoria,
  validarNomeDeCategoria,
  mensagemDeErroDeNome,
  MAX_NOME_DE_CATEGORIA,
  SUBCATEGORIA_PADRAO,
  type Categoria,
  type CategoriaEfetiva,
  type PreferenciaDeCategoria,
  type Subcategoria,
} from "@/lib/categorias";

/** As duas abas. Receita e despesa nunca se misturam num seletor nem aqui. */
type Aba = "expense" | "income";

export default function CategoriasPage() {
  const [aba, setAba] = useState<Aba>("expense");
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [prefs, setPrefs] = useState<PreferenciaDeCategoria[]>([]);
  const [subcategorias, setSubcategorias] = useState<Subcategoria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [expandida, setExpandida] = useState<string | null>(null);
  const [novaCategoria, setNovaCategoria] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const resposta = await fetch("/api/personal-finance/categories");
      if (!resposta.ok) throw new Error("falhou");
      const dados = await resposta.json();
      setCategorias(dados.categories ?? []);
      setPrefs(dados.prefs ?? []);
      setSubcategorias(dados.subcategories ?? []);
    } catch {
      toast.error("Não foi possível carregar as categorias.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // AQUI NAO SE USA `categoriasDoSeletor`, E ISSO E DE PROPOSITO.
  // Aquela funcao TIRA da lista o que esta escondido e o que esta desativado --
  // que e o certo num seletor de lancamento e exatamente errado aqui: esta e a
  // tela onde a pessoa precisa ver o que escondeu para poder trazer de volta.
  // Uma tela de gerenciar que usa o filtro do seletor e uma tela sem botao de
  // desfazer.
  const porCategoria = new Map(prefs.map((p) => [p.category_id, p]));
  const visiveis: CategoriaEfetiva[] = categorias
    .filter((c) => c.is_expense === (aba === "expense"))
    .map((c) => categoriaEfetiva(c, porCategoria.get(c.id)))
    .sort((a, b) => {
      if (a.doCatalogo !== b.doCatalogo) return a.doCatalogo ? 1 : -1;
      return a.name.localeCompare(b.name, "pt-BR");
    });

  const escondida = (id: string) =>
    Boolean(porCategoria.get(id)?.is_hidden);

  async function salvarNome(categoria: CategoriaEfetiva, nome: string) {
    const problema = validarNomeDeCategoria(
      nome,
      visiveis.map((c) => ({ id: c.id, name: c.name })),
      categoria.id
    );
    if (problema) {
      toast.error(mensagemDeErroDeNome(problema));
      return;
    }

    setSalvando(true);
    try {
      const resposta = await fetch(
        `/api/personal-finance/categories/${categoria.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nome.trim() }),
        }
      );
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        toast.error(dados.error || "Não foi possível salvar.");
        return;
      }
      // A FRASE DIZ QUAL DOS DOIS CAMINHOS ACONTECEU.
      // "Renomeada" numa categoria do catalogo seria mentira: a linha nao
      // mudou para ninguem alem de quem pediu, e e isso que a pessoa precisa
      // saber antes de perguntar por que o marido nao viu a mudanca.
      toast.success(
        dados.via === "preferencia"
          ? "Renomeada só para você."
          : "Categoria renomeada."
      );
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function alternarVisibilidade(categoria: CategoriaEfetiva) {
    const esconder = !escondida(categoria.id);
    setSalvando(true);
    try {
      const resposta = await fetch(
        `/api/personal-finance/categories/${categoria.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_hidden: esconder }),
        }
      );
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        toast.error(dados.error || "Não foi possível salvar.");
        return;
      }
      toast.success(
        esconder
          ? "Fora dos seus seletores. Os lançamentos antigos continuam com ela."
          : "De volta aos seus seletores."
      );
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(categoria: CategoriaEfetiva) {
    setSalvando(true);
    try {
      const resposta = await fetch(
        `/api/personal-finance/categories/${categoria.id}`,
        { method: "DELETE" }
      );
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        toast.error(dados.error || "Não foi possível remover.");
        return;
      }
      // Tres resultados diferentes, tres frases. "Excluída" sobre uma
      // categoria que foi apenas DESATIVADA (porque tinha lançamento
      // apontando para ela) faria a pessoa procurar no historico um dado que
      // continua la, com o nome certo.
      toast.success(
        dados.via === "excluida"
          ? "Categoria excluída."
          : dados.via === "desativada"
            ? "Ela tem lançamentos, então saiu da lista e o histórico ficou intacto."
            : "Escondida só para você."
      );
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function criarCategoria() {
    const problema = validarNomeDeCategoria(
      novaCategoria,
      visiveis.map((c) => ({ id: c.id, name: c.name }))
    );
    if (problema) {
      toast.error(mensagemDeErroDeNome(problema));
      return;
    }

    setSalvando(true);
    try {
      const resposta = await fetch("/api/personal-finance/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: novaCategoria.trim(),
          is_expense: aba === "expense",
        }),
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        toast.error(dados.error || "Não foi possível criar.");
        return;
      }
      setNovaCategoria("");
      toast.success(`Criada, já com a subcategoria "${SUBCATEGORIA_PADRAO}".`);
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function criarSubcategoria(categoriaId: string, nome: string) {
    const problema = validarNomeDeCategoria(
      nome,
      subcategoriasDaCategoria(subcategorias, categoriaId).map((s) => ({
        id: s.id,
        name: s.name,
      }))
    );
    if (problema) {
      toast.error(mensagemDeErroDeNome(problema));
      return false;
    }

    setSalvando(true);
    try {
      const resposta = await fetch("/api/personal-finance/subcategories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: categoriaId, name: nome.trim() }),
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        toast.error(dados.error || "Não foi possível criar a subcategoria.");
        return false;
      }
      toast.success("Subcategoria criada.");
      await carregar();
      return true;
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Categorias</h1>
        <p className="text-sm text-muted-foreground">
          Renomeie, troque a cor, esconda e crie subcategorias. As que vêm com o
          app podem ser personalizadas só para você.
        </p>
      </div>

      {/* `grid-cols-1` declarado: grid sem coluna estoura a largura no celular. */}
      <div className="grid grid-cols-1 gap-2 sm:inline-flex sm:gap-2">
        {(["expense", "income"] as Aba[]).map((valor) => (
          <Button
            key={valor}
            type="button"
            variant={aba === valor ? "default" : "outline"}
            onClick={() => {
              setAba(valor);
              setExpandida(null);
            }}
          >
            {valor === "expense" ? "Despesas" : "Receitas"}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nova categoria</CardTitle>
          <CardDescription>
            Ela nasce com a subcategoria &quot;{SUBCATEGORIA_PADRAO}&quot;.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <Input
              id="nova-categoria"
              value={novaCategoria}
              maxLength={MAX_NOME_DE_CATEGORIA}
              placeholder={aba === "expense" ? "Ex.: Pets" : "Ex.: Aluguéis"}
              onChange={(e) => setNovaCategoria(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  criarCategoria();
                }
              }}
            />
            <Button type="button" onClick={criarCategoria} disabled={salvando}>
              <Plus className="mr-2 h-4 w-4" />
              Criar
            </Button>
          </div>
        </CardContent>
      </Card>

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : visiveis.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma categoria de {aba === "expense" ? "despesa" : "receita"}.
        </p>
      ) : (
        <div className="space-y-3">
          {visiveis.map((categoria) => (
            <LinhaDeCategoria
              key={categoria.id}
              categoria={categoria}
              escondida={escondida(categoria.id)}
              subcategorias={subcategoriasDaCategoria(
                subcategorias,
                categoria.id
              )}
              expandida={expandida === categoria.id}
              salvando={salvando}
              aoExpandir={() =>
                setExpandida(expandida === categoria.id ? null : categoria.id)
              }
              aoRenomear={(nome) => salvarNome(categoria, nome)}
              aoAlternarVisibilidade={() => alternarVisibilidade(categoria)}
              aoExcluir={() => excluir(categoria)}
              aoCriarSubcategoria={(nome) =>
                criarSubcategoria(categoria.id, nome)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LinhaDeCategoria({
  categoria,
  escondida,
  subcategorias,
  expandida,
  salvando,
  aoExpandir,
  aoRenomear,
  aoAlternarVisibilidade,
  aoExcluir,
  aoCriarSubcategoria,
}: {
  categoria: CategoriaEfetiva;
  escondida: boolean;
  subcategorias: Subcategoria[];
  expandida: boolean;
  salvando: boolean;
  aoExpandir: () => void;
  aoRenomear: (nome: string) => void;
  aoAlternarVisibilidade: () => void;
  aoExcluir: () => void;
  aoCriarSubcategoria: (nome: string) => Promise<boolean>;
}) {
  const [nome, setNome] = useState(categoria.name);
  const [novaSub, setNovaSub] = useState("");

  // O campo e controlado por estado LOCAL, e `carregar()` troca a lista inteira
  // depois de cada escrita -- entao sem este efeito o input ficaria com o texto
  // antigo depois de salvar. Com `categoria.name` na dependencia ele acompanha
  // a resposta do servidor, que e a autoridade sobre o nome.
  useEffect(() => {
    setNome(categoria.name);
  }, [categoria.name]);

  const mudou = nome.trim() !== categoria.name;

  return (
    <Card className={escondida ? "opacity-60" : undefined}>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <Tag
            className="h-4 w-4 shrink-0"
            // A cor da categoria e dado do usuario, entao ela vai em `style` e
            // nao em classe -- Tailwind nao compila valor dinamico. O formato
            // `#RRGGBB` e validado na rota antes de gravar; aqui o `??` cobre o
            // dado antigo, de antes da validacao existir.
            style={{ color: categoria.color_hex ?? undefined }}
          />
          <Badge variant={categoria.doCatalogo ? "secondary" : "default"}>
            {categoria.doCatalogo ? "Do app" : "Sua"}
          </Badge>
          {categoria.personalizada && categoria.doCatalogo && (
            <Badge variant="outline">Personalizada</Badge>
          )}
          {escondida && <Badge variant="outline">Escondida</Badge>}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            value={nome}
            maxLength={MAX_NOME_DE_CATEGORIA}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (mudou) aoRenomear(nome);
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            // Desabilitado enquanto o nome nao mudou: um "Salvar" sempre
            // clicavel sobre um nome intocado manda um PATCH que a rota recusa
            // com "Nada para alterar" -- erro para um gesto que nao era erro.
            disabled={salvando || !mudou}
            onClick={() => aoRenomear(nome)}
          >
            {categoria.doCatalogo ? "Renomear só para mim" : "Renomear"}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={salvando}
            onClick={aoAlternarVisibilidade}
          >
            {escondida ? (
              <>
                <Eye className="mr-2 h-4 w-4" />
                Mostrar
              </>
            ) : (
              <>
                <EyeOff className="mr-2 h-4 w-4" />
                Esconder
              </>
            )}
          </Button>

          {/* "Excluir" SO na categoria da pessoa. No catalogo o gesto nao
              existe -- a linha e dos outros usuarios tambem --, e "Esconder"
              logo ao lado e o que a pessoa realmente quer ali. */}
          {!categoria.doCatalogo && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={salvando}
              onClick={aoExcluir}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Excluir
            </Button>
          )}

          <Button type="button" variant="ghost" size="sm" onClick={aoExpandir}>
            {expandida ? (
              <ChevronDown className="mr-2 h-4 w-4" />
            ) : (
              <ChevronRight className="mr-2 h-4 w-4" />
            )}
            {subcategorias.length === 1
              ? "1 subcategoria"
              : `${subcategorias.length} subcategorias`}
          </Button>
        </div>

        {expandida && (
          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
            {subcategorias.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhuma subcategoria ainda.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {subcategorias.map((sub) => (
                  <li key={sub.id} className="flex items-center gap-2">
                    <span>{sub.name}</span>
                    {/* "Outros" existe em toda categoria por invariante do
                        banco (036). Marcar isso evita a pergunta "por que esta
                        eu nao criei?". */}
                    {sub.name === SUBCATEGORIA_PADRAO && (
                      <Badge variant="outline" className="text-xs">
                        padrão
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <Label htmlFor={`nova-sub-${categoria.id}`} className="text-xs">
              Nova subcategoria
            </Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <Input
                id={`nova-sub-${categoria.id}`}
                value={novaSub}
                maxLength={MAX_NOME_DE_CATEGORIA}
                placeholder="Ex.: Mercado"
                onChange={(e) => setNovaSub(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (await aoCriarSubcategoria(novaSub)) setNovaSub("");
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={salvando}
                onClick={async () => {
                  if (await aoCriarSubcategoria(novaSub)) setNovaSub("");
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Criar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
