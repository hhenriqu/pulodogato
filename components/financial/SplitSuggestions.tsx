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
    user: {
      id: string;
      full_name: string;
      avatar_url?: string;
    };
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
        return <Users className="h-5 w-5 text-blue-600" />;
      case "proportional":
        return <TrendingUp className="h-5 w-5 text-green-600" />;
      case "historical":
        return <History className="h-5 w-5 text-purple-600" />;
      default:
        return <Calculator className="h-5 w-5 text-gray-600" />;
    }
  };

  const getSuggestionColor = (type: string) => {
    switch (type) {
      case "equal":
        return "border-blue-200 hover:border-blue-300";
      case "proportional":
        return "border-green-200 hover:border-green-300";
      case "historical":
        return "border-purple-200 hover:border-purple-300";
      default:
        return "border-gray-200 hover:border-gray-300";
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-yellow-500" />
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
      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600">
            <AlertCircle className="h-5 w-5" />
            Erro ao Carregar Sugestões
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 mb-4">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={loadSuggestions}
            className="border-red-200 text-red-600 hover:bg-red-50"
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
            <Lightbulb className="h-5 w-5 text-yellow-500" />
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
          <Lightbulb className="h-5 w-5 text-yellow-500" />
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
                        <AvatarImage src={split.user.avatar_url} />
                        <AvatarFallback className="text-xs">
                          {split.user.full_name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-xs font-medium">
                          {split.user.full_name}
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
                        {split.percentage.toFixed(1)}%
                      </p>
                      {split.amount && (
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
              <Users className="h-3 w-3 text-blue-600" />
              <span>Divisão igual padrão</span>
            </div>
            {suggestions.some((s) => s.type === "proportional") && (
              <div className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-green-600" />
                <span>Proporcional configurada</span>
              </div>
            )}
            {suggestions.some((s) => s.type === "historical") && (
              <div className="flex items-center gap-1">
                <History className="h-3 w-3 text-purple-600" />
                <span>Baseada no histórico</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
