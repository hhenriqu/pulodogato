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
import { PainelDeLimites } from "@/components/subscription/PainelDeLimites";
import { ConfiguracaoDePapel } from "@/components/papel-de-pao/ConfiguracaoDePapel";
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
  Gauge,
  StickyNote,
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
  /** O que ficou de proposito: grupo, divisao com pessoa, MyBank. */
  total_mantido?: number;
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
        toast.success(
          (d.total_mantido ?? 0) > 0
            ? "Pronto. Ficou só o que envolve outras pessoas."
            : "Tudo apagado. A conta está como nova."
        );
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
          <TabsTrigger value="limites">
            <Gauge className="h-4 w-4 mr-2" />
            Plano e limites
          </TabsTrigger>
          <TabsTrigger value="conta">
            <AlertTriangle className="h-4 w-4 mr-2" />
            Conta
          </TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------------- */}
        {/* Aba: plano e limites (HMO-162)                                    */}
        {/* ---------------------------------------------------------------- */}
        {/* Veio de Financas Pessoais, onde ocupava metade da barra de abas de
            uma tela cujo assunto e dinheiro que entrou e saiu. Quanto do plano
            ja foi usado e uma pergunta sobre a CONTA, e e aqui que as outras
            perguntas sobre a conta ja moravam. */}
        <TabsContent value="limites" className="space-y-4 mt-4">
          <PainelDeLimites />
        </TabsContent>

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

          {/* ---------------------------------------------------------------- */}
          {/* O espelho do papelzinho do cabecalho (HMO-283)                   */}
          {/* ---------------------------------------------------------------- */}
          {/* Mora nesta aba porque e "como o app se comporta", que e a fronteira
              que o comentario do topo deste arquivo ja define para a aba Painel.

              DEPOIS do Salvar de proposito, e fora do Card dos blocos: este
              interruptor NAO tem Save. Ele vale no clique e grava no aparelho,
              como o tema -- e nao em `profiles.preferences`, onde as outras duas
              abas gravam. Dentro daquele Card, acima do botao, ele pareceria
              fazer parte do que o botao salva, e quem clicasse em "Voltar ao
              padrao" esperaria o papel de pao voltar junto. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <StickyNote className="h-5 w-5" aria-hidden="true" />
                Papel de pão
              </CardTitle>
              <CardDescription>
                Deixa o app marrom e bege, com letra manuscrita. O mesmo
                interruptor está no papelzinho do cabeçalho.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ConfiguracaoDePapel />
            </CardContent>
          </Card>
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
                e-mail e o mesmo plano. O que envolve outra pessoa fica.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* O QUE FICA, ESCRITO ANTES DO CLIQUE (24/10/2026). A Leticia
                  apagou tudo e a aba Despesas continuou com R$ 78 do grupo
                  Casa: o reset tinha feito o certo, e a tela nao tinha dito.
                  A lista e a de lib/account-reset.ts ("O QUE FICA"). */}
              <div className="grid gap-3 sm:grid-cols-2 text-sm">
                <div className="rounded-lg border p-3 space-y-1">
                  <p className="font-medium">Vai embora</p>
                  <p className="text-muted-foreground">
                    Os seus lançamentos, contas e cartões, parcelamentos,
                    contas previstas, recorrências, orçamentos, metas e
                    aportes, investimentos, holerites, extratos importados,
                    regras de categorização, comprovantes (inclusive os
                    arquivos), os avisos e a ordem dos blocos do painel.
                  </p>
                </div>
                <div className="rounded-lg border p-3 space-y-1">
                  <p className="font-medium">Fica</p>
                  <p className="text-muted-foreground">
                    O seu acesso, o perfil (com moeda, fuso e chave Pix), o
                    plano, as conexões e as categorias que você criou. E tudo o
                    que envolve outra pessoa, logo abaixo.
                  </p>
                </div>
              </div>

              <div
                className="rounded-lg border p-3 space-y-2 text-sm"
                data-o-que-fica="outras-pessoas"
              >
                <p className="font-medium flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Fica também, porque outra pessoa vê
                </p>
                <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                  <li>
                    <span className="text-foreground">Grupos de despesa.</span>{" "}
                    Você continua em cada um, e fica o que é do grupo: os
                    lançamentos e as contas previstas de grupo, as recorrências,
                    os orçamentos e as metas de grupo com os seus aportes, o
                    Pagamento ao grupo e o A receber do grupo de cada
                    fechamento, e os comprovantes de acerto.
                  </li>
                  <li>
                    <span className="text-foreground">Divisão com pessoa.</span>{" "}
                    O lançamento dividido, e as contas Pagamento a e A receber
                    de que nasceram dele.
                  </li>
                  <li>
                    <span className="text-foreground">MyBank.</span> Os
                    empréstimos, as parcelas e os lançamentos e as contas
                    previstas deles.
                  </li>
                  <li>
                    <span className="text-foreground">
                      O pagamento de uma conta que ficou.
                    </span>{" "}
                    Sem ele, a conta voltaria a aparecer em aberto.
                  </li>
                  <li>
                    <span className="text-foreground">
                      As contas e os cartões onde algo disso mora.
                    </span>{" "}
                    O saldo deles passa a contar só o que ficou.
                  </li>
                </ul>
              </div>

              {/* A consequencia que se ve depois do clique. Sem esta linha, a
                  despesa do grupo na conta "nova" parece dado que nao saiu. */}
              <Alert>
                <Users className="h-4 w-4" />
                <AlertDescription>
                  Para os outros membros e para quem dividiu com você nada
                  muda: o saldo dos grupos, as divisões e os empréstimos
                  continuam iguais. Por isso as despesas que os outros membros
                  lançam no grupo continuam chegando para você: na aba
                  Despesas, como &ldquo;Despesas do Grupo&rdquo;, pela sua
                  parte. Para sair de um grupo, use a{" "}
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
                  {!resultado.ok
                    ? "O apagamento terminou pela metade"
                    : (resultado.total_mantido ?? 0) > 0
                      ? "Pronto — ficou só o que envolve outras pessoas"
                      : "Pronto — a conta está como nova"}
                </CardTitle>
                <CardDescription>
                  {resultado.total_apagado}{" "}
                  {resultado.total_apagado === 1
                    ? "registro apagado"
                    : "registros apagados"}
                  {(resultado.total_mantido ?? 0) > 0 && (
                    <>
                      {" · "}
                      {resultado.total_mantido}{" "}
                      {resultado.total_mantido === 1 ? "ficou" : "ficaram"}
                    </>
                  )}
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
                    className="text-sm py-1 border-b last:border-0"
                    data-passo-do-reset={passo.tabela}
                  >
                    <div className="flex items-center justify-between gap-3">
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
                          {(passo.mantidas ?? 0) > 0 &&
                            ` · ${passo.mantidas} ${
                              passo.mantidas === 1 ? "ficou" : "ficaram"
                            }`}
                        </span>
                      )}
                    </div>
                    {/* Por que ficou: a mesma lista do cartao de cima, so com
                        o que este passo segurou. */}
                    {(passo.mantidas ?? 0) > 0 && passo.motivos && (
                      <p className="text-xs text-muted-foreground">
                        {passo.motivos.join("; ")}
                      </p>
                    )}
                    {(passo.recusadas ?? 0) > 0 && (
                      <p className="text-xs text-destructive">
                        {passo.recusadas}{" "}
                        {passo.recusadas === 1
                          ? "não saiu, recusado pelo banco"
                          : "não saíram, recusados pelo banco"}
                        : {passo.motivoDaRecusa}
                      </p>
                    )}
                    {passo.apagadas !== null && passo.erro && (
                      <p className="text-xs text-destructive">{passo.erro}</p>
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
              Isto apaga os seus dados financeiros de forma definitiva. O que
              envolve outra pessoa (grupos, divisões e MyBank) fica. Para
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
