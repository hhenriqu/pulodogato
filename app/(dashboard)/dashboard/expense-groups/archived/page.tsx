"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Archive, ArrowLeft, RotateCcw, Users, AlertCircle } from "lucide-react";

interface MembroArquivado {
  id: string;
  user_id: string;
  role: string;
  user?: { id: string; full_name: string | null } | null;
}

interface GrupoArquivado {
  id: string;
  name: string;
  description: string | null;
  group_code: string | null;
  archived_at: string | null;
  // Pode vir nulo: a FK de archived_by e ON DELETE SET NULL, entao um grupo
  // arquivado por quem depois saiu do app continua na lista, sem o nome.
  archiver?: { full_name: string | null } | null;
  members: MembroArquivado[];
  userRole: string;
}

export default function GruposArquivadosPage() {
  const [grupos, setGrupos] = useState<GrupoArquivado[]>([]);
  const [carregando, setCarregando] = useState(true);
  // Separado da lista vazia de proposito. Uma falha de rede que caia no mesmo
  // estado de "nenhum grupo arquivado" e o zero confiante: a tela afirma que
  // nao existe nada quando na verdade ela nao conseguiu perguntar.
  const [erro, setErro] = useState<string | null>(null);
  const [restaurando, setRestaurando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resposta = await fetch("/api/expense-groups/archived");
      const corpo = await resposta.json().catch(() => null);

      if (!resposta.ok) {
        throw new Error(
          corpo?.error || `A lista nao veio (HTTP ${resposta.status}).`
        );
      }

      setGrupos(corpo?.archived_groups || []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar os grupos.");
      setGrupos([]);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const restaurar = async (grupo: GrupoArquivado) => {
    setRestaurando(grupo.id);
    try {
      const resposta = await fetch(
        `/api/expense-groups/${grupo.id}/restore`,
        { method: "POST" }
      );
      const corpo = await resposta.json().catch(() => null);

      if (!resposta.ok) {
        throw new Error(corpo?.error || `Nao deu (HTTP ${resposta.status}).`);
      }

      toast.success(corpo?.message || `Grupo "${grupo.name}" restaurado.`);
      await carregar();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Erro ao restaurar o grupo."
      );
    } finally {
      setRestaurando(null);
    }
  };

  const dataLegivel = (iso: string | null) => {
    if (!iso) return "data nao registrada";
    try {
      return format(new Date(iso), "d 'de' MMMM 'de' yyyy", { locale: ptBR });
    } catch {
      return "data nao registrada";
    }
  };

  return (
    <div className="space-y-6">
      {/* flex-wrap: sem ele a linha de acao do cabecalho empurra a pagina para
          o lado no celular -- foi um dos tres mecanismos da HMO-168. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Archive className="h-6 w-6" />
            Grupos arquivados
          </h1>
          <p className="text-sm text-muted-foreground">
            Grupos que voce arquivou ou dos quais foi o ultimo a sair. O
            historico de transacoes continua guardado.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard/expense-groups">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar aos grupos
          </Link>
        </Button>
      </div>

      {carregando && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Carregando...
          </CardContent>
        </Card>
      )}

      {!carregando && erro && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-8">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Nao foi possivel carregar a lista.
              </p>
              {/* Dizer o que aconteceu, e nao "voce nao tem grupos
                  arquivados" -- sao coisas diferentes. */}
              <p className="text-sm text-muted-foreground">{erro}</p>
            </div>
            <Button variant="outline" size="sm" onClick={carregar}>
              Tentar de novo
            </Button>
          </CardContent>
        </Card>
      )}

      {!carregando && !erro && grupos.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <Archive className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              Nenhum grupo arquivado
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Quando voce arquivar um grupo, ele aparece aqui e pode ser
              restaurado.
            </p>
          </CardContent>
        </Card>
      )}

      {!carregando && !erro && grupos.length > 0 && (
        <div className="flex flex-col gap-4">
          {grupos.map((grupo) => (
            <Card key={grupo.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
                      {grupo.name}
                      {grupo.userRole === "admin" && (
                        <Badge variant="secondary">admin</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      Arquivado em {dataLegivel(grupo.archived_at)}
                      {grupo.archiver?.full_name
                        ? ` por ${grupo.archiver.full_name}`
                        : ""}
                    </CardDescription>
                  </div>

                  {grupo.userRole === "admin" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => restaurar(grupo)}
                      disabled={restaurando === grupo.id}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      {restaurando === grupo.id
                        ? "Restaurando..."
                        : "Restaurar"}
                    </Button>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-2">
                {grupo.description && (
                  <p className="text-sm text-muted-foreground">
                    {grupo.description}
                  </p>
                )}
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-4 w-4" />
                  {grupo.members.length}{" "}
                  {grupo.members.length === 1 ? "participante" : "participantes"}
                </p>
                {grupo.userRole !== "admin" && (
                  <p className="text-sm text-muted-foreground">
                    Só administradores do grupo podem restaurar.
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
