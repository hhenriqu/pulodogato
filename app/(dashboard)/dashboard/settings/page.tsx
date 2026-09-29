"use client";

// -----------------------------------------------------------------------------
// CONFIGURACOES (HMO-159, e a aba Moeda na HMO-171)
// -----------------------------------------------------------------------------
// Tres abas, e elas sao deliberadamente desiguais:
//
//   Painel  -> o que aparece na tela inicial e em que ordem. Tudo aqui e
//              reversivel, entao salva com um clique e pronto.
//   Moeda   -> a moeda principal e o seletor de moeda por lancamento. Reversivel
//              tambem, mas em componente e com Save PROPRIOS -- ver o comentario
//              na aba: as duas rotas leem-e-mesclam o mesmo jsonb, e um botao
//              unico viraria dois PUT concorrentes sobre a mesma coluna.
//   Conta   -> apagar tudo e recomecar. Nada aqui e reversivel, entao exige
//              frase digitada e mostra o que sobrou depois.
//
// POR QUE O ARRASTAR VEM ACOMPANHADO DE DOIS BOTOES
// -------------------------------------------------
// O pedido falava em "drag and drop". Ele esta aqui, com a API nativa do
// HTML5 -- sem biblioteca, porque uma dependencia nova neste projeto tem
// custo proprio (`NODE_ENV=production` no ambiente de build poda as devDeps e
// a instalacao derruba o tsc).
//
// So que o drag-and-drop do HTML5 NAO dispara em tela de toque: no celular o
// dedo apenas rola a pagina. E este app e um PWA feito para ser instalado no
// celular. Um reordenar que so funciona no desktop falharia sem mensagem
// nenhuma justamente onde ele e mais usado -- a pessoa arrasta, nada acontece,
// e nao ha erro para reportar. Os botoes de subir e descer sao o caminho que
// funciona em toda plataforma, e de quebra sao o caminho de quem navega por
// teclado. O arrastar e o atalho; os botoes sao a garantia.
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ConfiguracaoDeMoeda } from "@/components/financial/ConfiguracaoDeMoeda";
import {
  LayoutDashboard,
  GripVertical,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  Save,
  Trash2,
  AlertTriangle,
  Users,
  Eye,
  EyeOff,
  Coins,
} from "lucide-react";
import {
  SECOES_DO_PAINEL,
  alternarVisibilidade,
  layoutPadrao,
  moverSecao,
  normalizarLayout,
  reordenarPorArrasto,
  type ItemDeLayout,
} from "@/lib/dashboard-layout";
import {
  FRASE_DE_CONFIRMACAO,
  confirmacaoValida,
  type ResultadoDePasso,
} from "@/lib/account-reset";

interface RespostaDeReset {
  ok: boolean;
  total_apagado: number;
  passos: ResultadoDePasso[];
  grupos_restantes: number;
}

export default function ConfiguracoesPage() {
  const [carregando, setCarregando] = useState(true);
  const [layout, setLayout] = useState<ItemDeLayout[]>(layoutPadrao());
  const [layoutSalvo, setLayoutSalvo] =
    useState<ItemDeLayout[]>(layoutPadrao());
  const [salvando, setSalvando] = useState(false);
  const [arrastando, setArrastando] = useState<string | null>(null);

  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [frase, setFrase] = useState("");
  const [apagando, setApagando] = useState(false);
  const [resultado, setResultado] = useState<RespostaDeReset | null>(null);

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const r = await fetch("/api/settings/dashboard");
        if (r.ok) {
          const d = await r.json();
          // Normaliza tambem no cliente. A rota ja normaliza, mas esta tela
          // nao pode depender disso: se um dia ela ler de outro lugar -- cache,
          // resposta antiga em memoria -- a lista chegaria incompleta e os
          // blocos novos sumiriam da tela de configuracao sem erro nenhum.
          const normalizado = normalizarLayout(d.layout);
          if (!ativo) return;
          setLayout(normalizado);
          setLayoutSalvo(normalizado);
        }
      } catch (erro) {
        console.error("Erro ao carregar as configurações do painel:", erro);
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);

  // Comparacao por conteudo, nao por referencia: reordenar e reordenar de
  // volta tem que apagar o aviso de "não salvo", senao o botao fica aceso
  // pedindo para salvar exatamente o que ja esta gravado.
  const haMudanca = useMemo(
    () => JSON.stringify(layout) !== JSON.stringify(layoutSalvo),
    [layout, layoutSalvo]
  );

  const visiveis = layout.filter((i) => i.visivel).length;

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await fetch("/api/settings/dashboard", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout }),
      });
      const d = await r.json();
      if (!r.ok) {
        toast.error(d.error ?? "Não foi possível salvar");
        return;
      }
      const normalizado = normalizarLayout(d.layout);
      setLayout(normalizado);
      setLayoutSalvo(normalizado);
      toast.success("Painel atualizado");
    } catch {
      toast.error("Não foi possível salvar");
    } finally {
      setSalvando(false);
    }
  };

  const apagarTudo = async () => {
    setApagando(true);
    setResultado(null);
    try {
      const r = await fetch("/api/account/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmacao: frase }),
      });
      const d = await r.json();

      if (r.status === 400 || r.status === 401) {
        toast.error(d.error ?? "Não foi possível apagar");
        return;
      }

      setResultado(d as RespostaDeReset);
      setDialogoAberto(false);
      setFrase("");

      // O painel volta de fabrica junto com os dados, entao a tela tem que
      // refletir isso sem exigir F5 -- caso contrario ela continua mostrando a
      // ordem antiga e o proximo "Salvar" regravaria o que acabou de ser
      // apagado.
      setLayout(layoutPadrao());
      setLayoutSalvo(layoutPadrao());

      if (d.ok) {
        toast.success("Tudo apagado. A conta está como nova.");
      } else {
        toast.error(
          "O apagamento terminou pela metade — veja o detalhe abaixo"
        );
      }
    } catch {
      toast.error("Não foi possível apagar");
    } finally {
      setApagando(false);
    }
  };

  if (carregando) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6 max-w-4xl">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">Configurações</h1>
        <p className="text-muted-foreground">
          Ajuste o que você vê no painel — e, se quiser, recomece do zero
        </p>
      </div>

      <Tabs defaultValue="painel">
        <TabsList>
          <TabsTrigger value="painel">
            <LayoutDashboard className="h-4 w-4 mr-2" />
            Painel
          </TabsTrigger>
          <TabsTrigger value="moeda">
            <Coins className="h-4 w-4 mr-2" />
            Moeda
          </TabsTrigger>
          <TabsTrigger value="conta">
            <AlertTriangle className="h-4 w-4 mr-2" />
            Conta
          </TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------------- */}
        {/* Aba: a moeda (HMO-171)                                            */}
        {/* ---------------------------------------------------------------- */}
        {/* Em componente proprio, e com Save proprio. O Save separado nao e
            detalhe de organizacao: esta aba grava em
            `profiles.preferences.moeda` e a aba Painel grava em
            `profiles.preferences.dashboard`. Um botao unico teria de mandar as
            duas coisas juntas, e as duas rotas leem-e-mesclam o jsonb inteiro --
            dois PUT concorrentes sobre a mesma coluna, em que o ultimo a gravar
            apaga o que o outro acabou de escrever. */}
        <TabsContent value="moeda" className="space-y-4 mt-4">
          <ConfiguracaoDeMoeda />
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        {/* Aba: o painel                                                     */}
        {/* ---------------------------------------------------------------- */}
        <TabsContent value="painel" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Blocos da tela inicial</CardTitle>
              <CardDescription>
                Desligue o que não usa e arraste para mudar a ordem. No celular,
                use as setas — arrastar não funciona em tela de toque.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {layout.map((item, indice) => {
                const secao = SECOES_DO_PAINEL.find((s) => s.id === item.id);
                if (!secao) return null;

                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={() => setArrastando(item.id)}
                    onDragEnd={() => setArrastando(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnter={() => {
                      if (arrastando && arrastando !== item.id) {
                        setLayout((atual) =>
                          reordenarPorArrasto(atual, arrastando, item.id)
                        );
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setArrastando(null);
                    }}
                    className={`flex items-center gap-3 rounded-lg border p-3 transition-opacity ${
                      arrastando === item.id ? "opacity-50" : ""
                    } ${item.visivel ? "" : "bg-muted/50"}`}
                  >
                    <GripVertical
                      className="h-5 w-5 text-muted-foreground shrink-0 cursor-grab"
                      aria-hidden="true"
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-medium truncate ${
                            item.visivel ? "" : "text-muted-foreground"
                          }`}
                        >
                          {secao.titulo}
                        </span>
                        {!item.visivel && (
                          <Badge variant="secondary" className="shrink-0">
                            <EyeOff className="h-3 w-3 mr-1" />
                            Oculto
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {secao.descricao}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={indice === 0}
                        aria-label={`Mover ${secao.titulo} para cima`}
                        onClick={() =>
                          setLayout((atual) => moverSecao(atual, item.id, -1))
                        }
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={indice === layout.length - 1}
                        aria-label={`Mover ${secao.titulo} para baixo`}
                        onClick={() =>
                          setLayout((atual) => moverSecao(atual, item.id, 1))
                        }
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Switch
                        checked={item.visivel}
                        aria-label={`Mostrar ${secao.titulo} no painel`}
                        onCheckedChange={() =>
                          setLayout((atual) =>
                            alternarVisibilidade(atual, item.id)
                          )
                        }
                      />
                    </div>
                  </div>
                );
              })}

              {/* Esconder tudo e uma escolha legitima -- mas a tela inicial
                  vazia e indistinguivel de tela quebrada, e quem chegar la sem
                  lembrar desta configuracao vai procurar o bug no lugar
                  errado. O aviso mora aqui, onde a escolha e feita. */}
              {visiveis === 0 && (
                <Alert>
                  <Eye className="h-4 w-4" />
                  <AlertDescription>
                    Com todos os blocos ocultos, a tela inicial fica só com o
                    cabeçalho e um atalho de volta para cá.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() => setLayout(layoutPadrao())}
              disabled={salvando}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Voltar ao padrão
            </Button>

            <div className="flex items-center gap-3">
              {haMudanca && (
                <span className="text-sm text-muted-foreground">
                  Há mudanças não salvas
                </span>
              )}
              <Button onClick={salvar} disabled={salvando || !haMudanca}>
                <Save className="h-4 w-4 mr-2" />
                {salvando ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        {/* Aba: a conta                                                      */}
        {/* ---------------------------------------------------------------- */}
        <TabsContent value="conta" className="space-y-4 mt-4">
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-destructive">
                <Trash2 className="h-5 w-5" />
                Apagar tudo e começar do zero
              </CardTitle>
              <CardDescription>
                Remove os seus dados financeiros e deixa a conta no estado de
                quem acabou de se cadastrar. Você continua logado, com o mesmo
                e-mail e o mesmo plano.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 text-sm">
                <div className="rounded-lg border p-3 space-y-1">
                  <p className="font-medium">Vai embora</p>
                  <p className="text-muted-foreground">
                    Lançamentos, contas e cartões, parcelamentos, contas
                    previstas, recorrências, orçamentos, metas e aportes,
                    holerites, extratos importados, regras de categorização,
                    comprovantes (inclusive os arquivos) e os avisos.
                  </p>
                </div>
                <div className="rounded-lg border p-3 space-y-1">
                  <p className="font-medium">Fica</p>
                  <p className="text-muted-foreground">
                    O seu acesso, o perfil, o plano — e os grupos de despesa,
                    que têm outras pessoas dentro.
                  </p>
                </div>
              </div>

              {/* A consequencia que nao e obvia, e que so aparece depois. Sem
                  esta linha, o usuario descobre pelo susto do outro membro. */}
              <Alert>
                <Users className="h-4 w-4" />
                <AlertDescription>
                  Se você participa de algum grupo de despesa, continua nele —
                  mas os seus lançamentos compartilhados vão junto, e isso muda
                  o saldo do grupo para os outros membros. Para sair de um
                  grupo, use a{" "}
                  <Link
                    href="/dashboard/expense-groups"
                    className="underline underline-offset-2"
                  >
                    tela de grupos
                  </Link>
                  .
                </AlertDescription>
              </Alert>

              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Não há como desfazer, e não há backup para restaurar.
                </AlertDescription>
              </Alert>

              <Separator />

              <Button
                variant="destructive"
                onClick={() => {
                  setFrase("");
                  setDialogoAberto(true);
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Apagar tudo
              </Button>
            </CardContent>
          </Card>

          {/* O relatorio. Ele aparece mesmo quando tudo deu certo: "apaguei N
              linhas em M passos" e a unica evidencia que o usuario tem de que
              o botao fez alguma coisa -- depois do reset, as telas ficam
              vazias, e tela vazia e o que ele veria tambem se nada tivesse
              acontecido. */}
          {resultado && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {resultado.ok
                    ? "Pronto — a conta está como nova"
                    : "O apagamento terminou pela metade"}
                </CardTitle>
                <CardDescription>
                  {resultado.total_apagado}{" "}
                  {resultado.total_apagado === 1
                    ? "registro apagado"
                    : "registros apagados"}
                  {resultado.grupos_restantes > 0 && (
                    <>
                      {" · "}
                      {resultado.grupos_restantes}{" "}
                      {resultado.grupos_restantes === 1
                        ? "grupo mantido"
                        : "grupos mantidos"}
                    </>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {!resultado.ok && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      Clicar em “Apagar tudo” de novo é seguro e retoma de onde
                      parou — o que já foi apagado não volta.
                    </AlertDescription>
                  </Alert>
                )}
                {resultado.passos.map((passo) => (
                  <div
                    key={passo.tabela}
                    className="flex items-center justify-between text-sm py-1 border-b last:border-0 gap-3"
                  >
                    <span className="truncate">{passo.rotulo}</span>
                    {passo.apagadas === null ? (
                      <span
                        className="text-destructive shrink-0 truncate max-w-[50%]"
                        title={passo.erro}
                      >
                        falhou
                      </span>
                    ) : (
                      <span className="text-muted-foreground shrink-0">
                        {passo.apagadas}
                      </span>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ------------------------------------------------------------------ */}
      {/* A confirmacao                                                       */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={dialogoAberto} onOpenChange={setDialogoAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apagar tudo?</DialogTitle>
            <DialogDescription>
              Isto apaga os seus dados financeiros de forma definitiva. Para
              confirmar, digite{" "}
              <span className="font-mono font-semibold">
                {FRASE_DE_CONFIRMACAO}
              </span>{" "}
              abaixo.
            </DialogDescription>
          </DialogHeader>

          <Input
            value={frase}
            onChange={(e) => setFrase(e.target.value)}
            placeholder={FRASE_DE_CONFIRMACAO}
            autoComplete="off"
            aria-label="Frase de confirmação"
          />

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogoAberto(false)}
              disabled={apagando}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={apagarTudo}
              disabled={apagando || !confirmacaoValida(frase)}
            >
              {apagando ? "Apagando…" : "Apagar tudo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
