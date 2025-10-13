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

interface DatabaseStatus {
  status: "healthy" | "needs_setup" | "partial" | "error";
  checks: Record<string, boolean>;
  errors: string[];
  needsSetup: boolean;
  setupInstructions?: string[];
}

export function DatabaseDiagnostic() {
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const checkDatabase = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/debug/database-check");
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      console.error("Failed to check database:", error);
      setStatus({
        status: "error",
        checks: {},
        errors: ["Failed to connect to diagnostic endpoint"],
        needsSetup: false,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkDatabase();
  }, []);

  if (!status && !loading) return null;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
        return "text-green-600";
      case "needs_setup":
        return "text-orange-600";
      case "partial":
        return "text-yellow-600";
      case "error":
        return "text-red-600";
      default:
        return "text-gray-600";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "healthy":
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case "needs_setup":
      case "partial":
      case "error":
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      default:
        return <Database className="h-5 w-5 text-gray-600" />;
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto mt-4">
      <CardHeader>
        <div className="flex items-center gap-2">
          {loading ? (
            <RefreshCw className="h-5 w-5 animate-spin" />
          ) : (
            getStatusIcon(status?.status || "error")
          )}
          <CardTitle className={getStatusColor(status?.status || "error")}>
            Diagnóstico do Banco de Dados
          </CardTitle>
        </div>
        <CardDescription>
          Status da conectividade e configuração do banco de dados
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
            <div className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(status.checks).map(([check, passed]) => (
                <div key={check} className="flex items-center gap-2">
                  {passed ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-red-500" />
                  )}
                  <span className={passed ? "text-green-700" : "text-red-700"}>
                    {check
                      .replace("_", " ")
                      .replace(/\b\w/g, (l) => l.toUpperCase())}
                  </span>
                </div>
              ))}
            </div>

            {status.errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <h4 className="font-medium text-red-800 mb-2">
                  Problemas encontrados:
                </h4>
                <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
                  {status.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            )}

            {status.needsSetup && status.setupInstructions && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                <h4 className="font-medium text-orange-800 mb-2">
                  🛠️ Configuração necessária:
                </h4>
                <ol className="list-decimal list-inside text-sm text-orange-700 space-y-1">
                  {status.setupInstructions.map((instruction, index) => (
                    <li key={index}>{instruction}</li>
                  ))}
                </ol>
                <div className="mt-3 p-2 bg-orange-100 rounded text-xs text-orange-800">
                  <strong>Arquivo SQL:</strong> docs/database-setup.sql
                </div>
              </div>
            )}

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

              {status.needsSetup && (
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
          <div className="text-center py-4 text-gray-500">
            Falha ao verificar status do banco de dados
          </div>
        )}
      </CardContent>
    </Card>
  );
}
