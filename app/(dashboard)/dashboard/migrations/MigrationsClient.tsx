"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CheckCircle2,
  XCircle,
  Database,
  ExternalLink,
  Copy,
} from "lucide-react";

interface MigrationStatus {
  migration: string;
  status: string;
  probeTable?: string;
  note?: string;
}

// Quem barra o nao-admin e o `page.tsx` ao lado, no servidor -- este componente
// assume que so admin chega aqui.
export default function MigrationsClient() {
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkMigrations = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/migrations/run");
      const result = await response.json();

      if (response.ok) {
        setMigrationStatus(result.status ?? []);
      } else {
        setError(result.error || "Erro ao verificar migrações");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const copyMigrationPath = (migration: string) => {
    const path = `database/migrations/${migration}`;
    navigator.clipboard.writeText(path);
  };

  const migrations = [
    {
      name: "001_baseline.sql",
      title: "Schema Base",
      description:
        "As 16 tabelas do app mais o seed de serviços e categorias",
      required: true,
      order: 1,
    },
    {
      name: "002_rls_lockdown.sql",
      title: "Row Level Security",
      description:
        "Fecha o acesso anônimo e isola os dados por usuário. Sem isto o banco fica aberto.",
      required: true,
      order: 2,
    },
  ];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Migrações do Banco de Dados</h1>
          <p className="text-muted-foreground mt-2">
            Gerencie e verifique o status das migrações do sistema
          </p>
        </div>
        <Button onClick={checkMigrations} disabled={loading} variant="outline">
          <Database className="mr-2 h-4 w-4" />
          {loading ? "Verificando..." : "Verificar Status"}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Alert>
        <Database className="h-4 w-4" />
        <AlertDescription>
          <strong>Importante:</strong> As migrações devem ser executadas
          manualmente no Supabase SQL Editor. Esta página apenas verifica o
          status atual das tabelas.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4">
        {migrations.map((migration) => {
          const statusInfo = migrationStatus.find(
            (s) => s.migration === migration.name
          );
          const isInstalled = statusInfo?.status === "instalado";
          const isUnknown = statusInfo?.status === "desconhecido";

          return (
            <Card key={migration.name} className="relative">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-medium">
                      {migration.order}
                    </div>
                    <div>
                      <CardTitle className="text-lg">
                        {migration.title}
                      </CardTitle>
                      <CardDescription>{migration.description}</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {migration.required && (
                      <Badge variant="secondary">Obrigatório</Badge>
                    )}
                    {statusInfo && (
                      <Badge
                        variant={
                          isInstalled
                            ? "default"
                            : isUnknown
                            ? "secondary"
                            : "destructive"
                        }
                      >
                        {isInstalled ? (
                          <>
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Instalado
                          </>
                        ) : isUnknown ? (
                          "Não verificável aqui"
                        ) : (
                          <>
                            <XCircle className="mr-1 h-3 w-3" />
                            Pendente
                          </>
                        )}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {statusInfo?.probeTable && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">
                      Verificado pela tabela:
                    </p>
                    <Badge variant="outline" className="text-xs">
                      {statusInfo.probeTable}
                    </Badge>
                  </div>
                )}

                {statusInfo?.note && (
                  <p className="text-sm text-muted-foreground">
                    {statusInfo.note}
                  </p>
                )}

                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>Arquivo:</span>
                    <code className="bg-muted px-2 py-1 rounded text-xs">
                      {migration.name}
                    </code>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyMigrationPath(migration.name)}
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Copiar Path
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <a
                        href="https://supabase.com/dashboard"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Abrir Supabase
                      </a>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Como Executar as Migrações</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="font-medium mb-2">Passo 1: Acessar Supabase</h4>
              <p className="text-sm text-muted-foreground">
                Faça login em supabase.com/dashboard e selecione seu projeto
              </p>
            </div>
            <div>
              <h4 className="font-medium mb-2">Passo 2: SQL Editor</h4>
              <p className="text-sm text-muted-foreground">
                Navegue até &quot;SQL Editor&quot; no menu lateral
              </p>
            </div>
            <div>
              <h4 className="font-medium mb-2">Passo 3: Copiar Migração</h4>
              <p className="text-sm text-muted-foreground">
                Copie o conteúdo completo do arquivo de migração
              </p>
            </div>
            <div>
              <h4 className="font-medium mb-2">Passo 4: Executar</h4>
              <p className="text-sm text-muted-foreground">
                Cole no editor e clique &quot;Run&quot; para executar
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
