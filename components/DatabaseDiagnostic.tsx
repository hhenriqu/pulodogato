"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, Database, RefreshCw } from "lucide-react";

interface HealthStatus {
  status: "ok" | "error";
  message: string;
}

export function DatabaseDiagnostic() {
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const checkDatabase = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/health");
      const data = await response.json();
      setStatus({
        status: data.status === "ok" ? "ok" : "error",
        message: data.message || "Status desconhecido",
      });
    } catch (error) {
      console.error("Failed to check database:", error);
      setStatus({
        status: "error",
        message: "Não foi possível contatar o servidor.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkDatabase();
  }, []);

  if (!status && !loading) return null;

  const isOk = status?.status === "ok";

  return (
    <Card className="w-full max-w-2xl mx-auto mt-4">
      <CardHeader>
        <div className="flex items-center gap-2">
          {loading ? (
            <RefreshCw className="h-5 w-5 animate-spin" />
          ) : isOk ? (
            <CheckCircle className="h-5 w-5 text-success" />
          ) : (
            <AlertCircle className="h-5 w-5 text-destructive" />
          )}
          <CardTitle className={isOk ? "text-success" : "text-destructive"}>
            Diagnóstico do Banco de Dados
          </CardTitle>
        </div>
        <CardDescription>
          Status da conectividade com o banco de dados
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-center py-4">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
            <p>Verificando banco de dados...</p>
          </div>
        ) : status ? (
          <>
            <div
              className={`rounded-lg border p-3 text-sm ${
                isOk
                  ? "bg-success/10 border-success/30 text-success"
                  : "bg-destructive/10 border-destructive/30 text-destructive"
              }`}
            >
              {isOk
                ? "Conexão com o banco de dados funcionando normalmente."
                : "Não foi possível conectar ao banco de dados. Verifique as variáveis de ambiente do Supabase e tente novamente."}
            </div>

            <div className="flex gap-2">
              <Button
                onClick={checkDatabase}
                variant="outline"
                size="sm"
                disabled={loading}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
                />
                Verificar novamente
              </Button>

              {!isOk && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() =>
                    window.open("https://supabase.com/dashboard", "_blank")
                  }
                >
                  <Database className="h-4 w-4 mr-2" />
                  Abrir Supabase Dashboard
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            Falha ao verificar status do banco de dados
          </div>
        )}
      </CardContent>
    </Card>
  );
}
