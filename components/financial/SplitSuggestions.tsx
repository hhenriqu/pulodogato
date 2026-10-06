"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Lightbulb,
  Users,
  TrendingUp,
  History,
  Calculator,
  Check,
  AlertCircle,
  Crown,
} from "lucide-react";

interface SplitSuggestion {
  type: "equal" | "proportional" | "historical";
  name: string;
  description: string;
  splits: {
    member_id: string;
    /**
     * `null` quando a RLS nao deixa este usuario ler o perfil do outro membro --
     * ver o rotulo de fallback no render. Ser do mesmo grupo nao da acesso a
     * `profiles`.
     */
    user: {
      id: string;
      full_name: string;
      avatar_url?: string;
    } | null;
    percentage: number;
    amount?: number;
    reason?: string;
  }[];
}

interface SplitSuggestionsProps {
  groupId: string;
  amount?: number;
  onSelectSuggestion?: (suggestion: SplitSuggestion) => void;
  selectedSuggestion?: SplitSuggestion | null;
}

export default function SplitSuggestions({
  groupId,
  amount,
  onSelectSuggestion,
  selectedSuggestion,
}: SplitSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<SplitSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSuggestions();
  }, [groupId, amount]);

  const loadSuggestions = async () => {
    try {
      setLoading(true);
      setError(null);

      const url = new URL(
        `/api/expense-groups/${groupId}/split-suggestions`,
        window.location.origin
      );
      if (amount && amount > 0) {
        url.searchParams.set("amount", amount.toString());
      }

      const response = await fetch(url.toString());
      const data = await response.json();

      if (response.ok) {
        setSuggestions(data.suggestions || []);
      } else {
        setError(data.error || "Erro ao carregar sugestões");
      }
    } catch (error) {
      console.error("Error loading suggestions:", error);
      setError("Erro ao carregar sugestões de divisão");
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const getSuggestionIcon = (type: string) => {
    switch (type) {
      case "equal":
        return <Users className="h-5 w-5 text-info" />;
      case "proportional":
        return <TrendingUp className="h-5 w-5 text-success" />;
      case "historical":
        return <History className="h-5 w-5 text-premium" />;
      default:
        return <Calculator className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getSuggestionColor = (type: string) => {
    switch (type) {
      case "equal":
        return "border-info/30 hover:border-info/60";
      case "proportional":
        return "border-success/30 hover:border-success/60";
      case "historical":
        return "border-premium/30 hover:border-premium/60";
      default:
        return "border-border hover:border-muted-foreground/40";
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-warning" />
            Sugestões de Divisão
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            Erro ao Carregar Sugestões
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive mb-4">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={loadSuggestions}
            className="border-destructive/30 text-destructive hover:bg-destructive/10"
          >
            Tentar Novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (suggestions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-warning" />
            Sugestões de Divisão
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhuma sugestão disponível para este grupo
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-warning" />
          Sugestões de Divisão
        </CardTitle>
        <CardDescription>
          Escolha uma forma inteligente de dividir a despesa
          {amount && amount > 0 && ` (${formatCurrency(amount)})`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {suggestions.map((suggestion, index) => (
          <div
            key={index}
            className={`relative border rounded-lg p-4 transition-all cursor-pointer ${getSuggestionColor(
              suggestion.type
            )} ${
              selectedSuggestion === suggestion
                ? "ring-2 ring-primary bg-primary/5"
                : "hover:shadow-sm"
            }`}
            onClick={() => onSelectSuggestion?.(suggestion)}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                {getSuggestionIcon(suggestion.type)}
                <div>
                  <h4 className="font-semibold text-sm">{suggestion.name}</h4>
                  <p className="text-xs text-muted-foreground">
                    {suggestion.description}
                  </p>
                </div>
              </div>

              {selectedSuggestion === suggestion && (
                <div className="flex items-center gap-1">
                  <Check className="h-4 w-4 text-primary" />
                  <Badge variant="default" className="text-xs">
                    Selecionado
                  </Badge>
                </div>
              )}
            </div>

            {/* Splits Preview */}
            <div className="space-y-2">
              <Separator />
              <div className="grid grid-cols-1 gap-2 max-h-32 overflow-y-auto">
                {suggestion.splits.map((split) => (
                  <div
                    key={split.member_id}
                    className="flex items-center justify-between py-1 px-2 bg-background/50 rounded"
                  >
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={split.user?.avatar_url} />
                        <AvatarFallback className="text-xs">
                          {split.user?.full_name?.charAt(0) || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-xs font-medium">
                          {/* Nome ausente e caminho NORMAL, e nao erro: nenhuma
                              policy de `profiles` olha `group_members`, entao o
                              embed do perfil de outro membro volta nulo pela
                              RLS. Sem rotulo, a linha apareceria so com o
                              percentual -- uma parte de dinheiro sem dono. */}
                          {split.user?.full_name || "Membro do grupo"}
                        </p>
                        {split.reason && (
                          <p className="text-xs text-muted-foreground">
                            {split.reason}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="text-xs font-semibold">
                        {/* Duas casas, e em pt-BR. Com `toFixed(1)` a divisao
                            igual de tres membros mostrava "33.3%" nas tres
                            linhas: o 33,34 que fecha a soma e o 33,33 ficavam
                            indistinguiveis, e a coluna de percentuais parecia
                            somar 99,9%. */}
                        {split.percentage.toFixed(2).replace(".", ",")}%
                      </p>
                      {/* `!== undefined`, e nao `&&`: a parte de um membro em 0%
                          e R$ 0,00, que e falsy. Com `&&` a unica linha sem
                          valor na previa era justamente a de quem nao paga --
                          que se le como "o valor dele ainda nao carregou". */}
                      {split.amount !== undefined && (
                        <p className="text-xs text-muted-foreground">
                          {formatCurrency(split.amount)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Action Button */}
            <div className="mt-3 pt-3 border-t">
              <Button
                variant={
                  selectedSuggestion === suggestion ? "default" : "outline"
                }
                size="sm"
                className="w-full"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectSuggestion?.(suggestion);
                }}
              >
                {selectedSuggestion === suggestion
                  ? "Selecionado"
                  : "Usar Esta Divisão"}
              </Button>
            </div>
          </div>
        ))}

        {/* Summary */}
        <div className="mt-4 p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Calculator className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Resumo das Opções</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Users className="h-3 w-3 text-info" />
              <span>Divisão igual padrão</span>
            </div>
            {suggestions.some((s) => s.type === "proportional") && (
              <div className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-success" />
                <span>Divisão configurada do grupo</span>
              </div>
            )}
            {suggestions.some((s) => s.type === "historical") && (
              <div className="flex items-center gap-1">
                <History className="h-3 w-3 text-premium" />
                <span>Baseada no histórico</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
