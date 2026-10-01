"use client";

// ---------------------------------------------------------------------------
// OS DOIS SELETORES, E O "CRIAR" DENTRO DELES (HMO-216)
// ---------------------------------------------------------------------------
// "ao selecionar uma categoria, ele tem a opcao de criar uma nova categoria, e
// as categorias agora devem contar com uma subcategoria."
//
// Isto saiu de `CamposDeLancamento` por um motivo concreto: o bloco de
// categoria deixou de ser um `<Select>` e passou a ter cinco estados (lista,
// digitando nome de categoria, salvando, erro, lista com a nova escolhida),
// duas listas que dependem uma da outra, e dois caminhos de criacao. Dentro de
// um componente de 700 linhas que ja desenha dez campos, isso vira o tipo de
// JSX em que o terceiro estado nunca e exercitado.
//
// SEM REDE AQUI, de proposito. As duas criacoes sao callbacks
// (`aoCriarCategoria`, `aoCriarSubcategoria`) e quem fala com a API e o
// container -- que e tambem quem tem a fila offline. Assim este componente
// renderiza em `react-dom/server` no teste, com a arvore de verdade.
//
// A OPCAO DE CRIAR E UM ITEM DA LISTA, nao um botao ao lado. Foi o que o pedido
// descreve ("ao selecionar uma categoria, ele tem a opcao de criar"), e e o que
// funciona no celular: a lista ja esta aberta e o dedo ja esta nela. Um botao
// "+" ao lado do seletor obriga a fechar a lista para descobrir que o que se
// queria nao estava nela.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import {
  categoriasDoSeletor,
  subcategoriasDaCategoria,
  subcategoriaCoerente,
  validarNomeDeCategoria,
  mensagemDeErroDeNome,
  MAX_NOME_DE_CATEGORIA,
  type Categoria,
  type PreferenciaDeCategoria,
  type Subcategoria,
} from "@/lib/categorias";
import type { TipoLancamento } from "@/lib/lancamento";

/**
 * O valor do item "criar".
 *
 * Um sentinela, e nao `""`: `""` e o que o Radix usa para "nada escolhido", e
 * os dois colidiriam -- abrir a lista sem nada escolhido abriria o campo de
 * digitar sozinho.
 *
 * O prefixo `__` e os dois underscores finais nao sao decoracao: o valor
 * concorre com ids que vem do banco, e um `uuid` nunca casa com isto.
 */
const CRIAR = "__criar__";

/** O que o container devolve depois de criar. `erro` e texto para a tela. */
export interface ResultadoDeCriacao {
  id?: string;
  erro?: string;
}

interface SeletorDeCategoriaProps {
  tipo: TipoLancamento;
  /** Catalogo + as da pessoa, como vem de `/api/personal-finance/categories`. */
  categorias: Categoria[];
  /** A personalizacao da pessoa. Vazio e o caso normal. */
  prefs?: PreferenciaDeCategoria[];
  subcategorias: Subcategoria[];
  categoriaId: string;
  subcategoriaId: string;
  aoMudar: (mudanca: { categoriaId?: string; subcategoriaId?: string }) => void;
  /**
   * Cria a categoria no servidor e devolve o id. Opcional: a tela de edicao
   * offline passa `undefined` e o item "criar" desaparece -- oferecer um botao
   * que vai falhar e pior que nao oferecer.
   */
  aoCriarCategoria?: (nome: string) => Promise<ResultadoDeCriacao>;
  aoCriarSubcategoria?: (
    categoriaId: string,
    nome: string
  ) => Promise<ResultadoDeCriacao>;
}

export function SeletorDeCategoria({
  tipo,
  categorias,
  prefs = [],
  subcategorias,
  categoriaId,
  subcategoriaId,
  aoMudar,
  aoCriarCategoria,
  aoCriarSubcategoria,
}: SeletorDeCategoriaProps) {
  // `"categoria" | "subcategoria" | null` em vez de dois booleanos: os dois
  // campos de digitar nunca aparecem juntos, e dois booleanos deixam o estado
  // "os dois abertos" representavel -- que e o estado que ninguem desenha.
  const [criando, setCriando] = useState<"categoria" | "subcategoria" | null>(
    null
  );
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const visiveis = categoriasDoSeletor(categorias, prefs, tipo);
  const subVisiveis = subcategoriasDaCategoria(subcategorias, categoriaId);

  function fecharCriacao() {
    setCriando(null);
    setNome("");
    setErro(null);
  }

  function escolherCategoria(valor: string) {
    if (valor === CRIAR) {
      setCriando("categoria");
      setNome("");
      setErro(null);
      return;
    }
    // A SUBCATEGORIA MUDA JUNTO, SEMPRE.
    // Trocar de categoria deixando `subcategoriaId` como estava e o caminho
    // direto para um 23503 na hora de salvar: a FK composta da 036 exige que a
    // subcategoria seja daquela categoria. `subcategoriaCoerente` devolve a
    // mesma (se ainda servir) ou a "Outros" da nova.
    aoMudar({
      categoriaId: valor,
      subcategoriaId: subcategoriaCoerente(subcategorias, valor, subcategoriaId),
    });
    fecharCriacao();
  }

  function escolherSubcategoria(valor: string) {
    if (valor === CRIAR) {
      setCriando("subcategoria");
      setNome("");
      setErro(null);
      return;
    }
    aoMudar({ subcategoriaId: valor });
    fecharCriacao();
  }

  async function salvarNova() {
    // Validar aqui, antes do fetch, para que "já existe" e "nome muito longo"
    // apareçam como frases diferentes em vez de um 400 generico. A autoridade
    // continua sendo o banco -- isto so antecipa o caso comum.
    const escopo =
      criando === "categoria"
        ? visiveis.map((c) => ({ id: c.id, name: c.name }))
        : subVisiveis.map((s) => ({ id: s.id, name: s.name }));

    const problema = validarNomeDeCategoria(nome, escopo);
    if (problema) {
      setErro(mensagemDeErroDeNome(problema));
      return;
    }

    setSalvando(true);
    setErro(null);
    try {
      const resultado =
        criando === "categoria"
          ? await aoCriarCategoria?.(nome.trim())
          : await aoCriarSubcategoria?.(categoriaId, nome.trim());

      if (!resultado?.id) {
        // O erro do servidor tem precedencia sobre qualquer texto nosso: ele
        // e quem sabe se foi corrida, permissao ou schema nao aplicado.
        setErro(resultado?.erro ?? "Não foi possível criar agora.");
        return;
      }

      // A nova JA VEM ESCOLHIDA. Criar e voltar para a lista com nada marcado
      // obrigaria a pessoa a procurar, no meio de 13 itens, a coisa que ela
      // acabou de escrever.
      if (criando === "categoria") {
        aoMudar({ categoriaId: resultado.id, subcategoriaId: "" });
      } else {
        aoMudar({ subcategoriaId: resultado.id });
      }
      fecharCriacao();
    } finally {
      setSalvando(false);
    }
  }

  const rotuloDaCategoria =
    tipo === "expense" ? "Categoria da despesa *" : "Categoria da receita *";

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="category">{rotuloDaCategoria}</Label>

        {criando === "categoria" ? (
          <CampoDeNome
            id="nova-categoria"
            rotulo="Nome da nova categoria"
            nome={nome}
            setNome={setNome}
            erro={erro}
            salvando={salvando}
            aoSalvar={salvarNova}
            aoCancelar={fecharCriacao}
          />
        ) : (
          <>
            <Select value={categoriaId} onValueChange={escolherCategoria}>
              <SelectTrigger id="category">
                <SelectValue placeholder="Selecione uma categoria" />
              </SelectTrigger>
              <SelectContent>
                {visiveis.map((categoria) => (
                  <SelectItem key={categoria.id} value={categoria.id}>
                    {categoria.name}
                  </SelectItem>
                ))}
                {aoCriarCategoria && (
                  <>
                    {visiveis.length > 0 && <SelectSeparator />}
                    <SelectItem value={CRIAR}>
                      <span className="flex items-center gap-2">
                        <Plus className="h-4 w-4" />
                        Criar nova categoria
                      </span>
                    </SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>

            {/* Uma lista vazia nao e "escolha uma": e "nao ha o que escolher".
                Com o item de criar na lista, a saida deixou de ser "abra com
                internet" -- da para criar a primeira categoria aqui. */}
            {visiveis.length === 0 && (
              <p className="text-xs text-warning">
                Nenhuma categoria de{" "}
                {tipo === "expense" ? "despesa" : "receita"} disponível.
                {aoCriarCategoria
                  ? " Crie a primeira pela opção acima."
                  : " Abra esta tela uma vez com internet."}
              </p>
            )}
          </>
        )}
      </div>

      {/* O SEGUNDO SELETOR SO EXISTE DEPOIS DO PRIMEIRO.
          Subcategoria sem categoria escolhida nao tem lista a mostrar -- e um
          seletor vazio ali se le como "ainda carregando", que e a leitura
          errada: nao vai carregar nunca. */}
      {categoriaId && (
        <div className="space-y-2">
          <Label htmlFor="subcategory">Subcategoria</Label>

          {criando === "subcategoria" ? (
            <CampoDeNome
              id="nova-subcategoria"
              rotulo="Nome da nova subcategoria"
              nome={nome}
              setNome={setNome}
              erro={erro}
              salvando={salvando}
              aoSalvar={salvarNova}
              aoCancelar={fecharCriacao}
            />
          ) : (
            <>
              <Select
                value={subcategoriaId}
                onValueChange={escolherSubcategoria}
              >
                <SelectTrigger id="subcategory">
                  <SelectValue placeholder="Selecione uma subcategoria" />
                </SelectTrigger>
                <SelectContent>
                  {subVisiveis.map((sub) => (
                    <SelectItem key={sub.id} value={sub.id}>
                      {sub.name}
                    </SelectItem>
                  ))}
                  {aoCriarSubcategoria && (
                    <>
                      {subVisiveis.length > 0 && <SelectSeparator />}
                      <SelectItem value={CRIAR}>
                        <span className="flex items-center gap-2">
                          <Plus className="h-4 w-4" />
                          Criar nova subcategoria
                        </span>
                      </SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>

              {/* Toda categoria TEM "Outros" por invariante da 036. Lista vazia
                  aqui significa uma coisa so: a migration ainda nao foi colada
                  no banco. O aviso diz o que e verdade sem citar schema --
                  deploy publica codigo, nao schema. */}
              {subVisiveis.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Esta categoria ainda não tem subcategorias.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

/**
 * O campo de digitar o nome, com salvar e cancelar.
 *
 * Extraido porque categoria e subcategoria usam o MESMO campo: duas copias
 * divergiriam na primeira vez que alguem ajustasse o `maxLength` ou o texto do
 * erro, e a divergencia apareceria so num dos dois caminhos.
 *
 * `Cancelar` existe e e load-bearing: sem ele, quem abriu o campo por engano
 * fica preso -- o seletor nao esta mais na tela para voltar a escolher.
 *
 * EXPORTADO por causa do teste, e isto merece a explicacao: o estado `criando`
 * e interno, entao `renderToStaticMarkup(<SeletorDeCategoria .../>)` nunca
 * alcanca este bloco -- nao ha prop que o abra. E o que precisa de prova aqui
 * e JSX, nao decisao: os dois `type="button"` e o `preventDefault` do Enter
 * sao o que impede que criar uma categoria SUBMETA o lancamento inteiro, e
 * nenhuma funcao pura mostra isso.
 */
export function CampoDeNome({
  id,
  rotulo,
  nome,
  setNome,
  erro,
  salvando,
  aoSalvar,
  aoCancelar,
}: {
  id: string;
  rotulo: string;
  nome: string;
  setNome: (v: string) => void;
  erro: string | null;
  salvando: boolean;
  aoSalvar: () => void;
  aoCancelar: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {rotulo}
      </Label>
      {/* `grid-cols-1` no celular: `sm:` muda para a linha de tres. Um grid sem
          coluna declarada estoura a largura da pagina no telefone. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
        <Input
          id={id}
          value={nome}
          maxLength={MAX_NOME_DE_CATEGORIA}
          placeholder="Ex.: Mercado"
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            // Enter salva, e o `preventDefault` nao e opcional: este campo vive
            // dentro do <form> do lancamento, e sem ele o Enter SUBMETE o
            // lancamento inteiro -- com a categoria antiga, ou nenhuma.
            if (e.key === "Enter") {
              e.preventDefault();
              aoSalvar();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              aoCancelar();
            }
          }}
        />
        {/* `type="button"` nos dois, pelo mesmo motivo do Enter acima: o default
            de <button> dentro de <form> e submit. */}
        <Button type="button" onClick={aoSalvar} disabled={salvando}>
          {salvando ? "Criando..." : "Criar"}
        </Button>
        <Button type="button" variant="ghost" onClick={aoCancelar} disabled={salvando}>
          Cancelar
        </Button>
      </div>
      {erro && <p className="text-xs text-destructive">{erro}</p>}
    </div>
  );
}
