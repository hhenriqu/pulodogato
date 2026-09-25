import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TrendingUp, Shield, Smartphone, BarChart3 } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-primary/10">
      {/* Header */}
      <header className="p-4">
        <nav className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <TrendingUp className="h-8 w-8 text-info" />
            <h1 className="text-2xl font-bold text-foreground">PulodoGato</h1>
          </div>
          <Link href="/login">
            <Button>Entrar</Button>
          </Link>
        </nav>
      </header>

      {/* Hero Section */}
      <main className="max-w-6xl mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h2 className="text-5xl font-bold text-foreground mb-6">
            Controle suas <span className="text-info">Finanças</span> e{" "}
            <span className="text-success">Investimentos</span>
          </h2>
          <p className="text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            A plataforma completa para gerenciar suas finanças pessoais,
            investimentos e trading. Do controle de gastos aos sinais de trading
            profissionais, tudo em um só lugar.
          </p>
          <div className="flex flex-col sm:flex-row sm:flex-wrap items-center justify-center gap-4">
            <Link href="/signup" className="w-full sm:w-auto">
              <Button size="lg" className="w-full px-8 py-3">
                Criar Conta Grátis
              </Button>
            </Link>
            <Link href="/login" className="w-full sm:w-auto">
              <Button variant="outline" size="lg" className="w-full px-8 py-3">
                Fazer Login
              </Button>
            </Link>
          </div>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          <Card>
            <CardHeader className="text-center">
              <BarChart3 className="h-12 w-12 text-info mx-auto mb-4" />
              <CardTitle className="text-lg">Finanças Pessoais</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                Controle completo de receitas, despesas e grupos de gastos
                compartilhados
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="text-center">
              <TrendingUp className="h-12 w-12 text-success mx-auto mb-4" />
              <CardTitle className="text-lg">Investimentos</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                Acompanhamento de portfólio, análise de performance e alertas
                inteligentes
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="text-center">
              <Smartphone className="h-12 w-12 text-premium mx-auto mb-4" />
              <CardTitle className="text-lg">Trading Profissional</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                Sinais em tempo real, gráficos avançados e API para traders
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="text-center">
              <Shield className="h-12 w-12 text-warning mx-auto mb-4" />
              <CardTitle className="text-lg">Planos Flexíveis</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                Do gratuito ao profissional, escolha o plano ideal para você
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        {/* CTA Section */}
        <div className="text-center bg-card rounded-lg p-8 shadow-lg">
          <h3 className="text-3xl font-bold text-foreground mb-4">
            Pronto para começar?
          </h3>
          <p className="text-muted-foreground mb-6">
            Cadastre-se gratuitamente e comece a organizar suas finanças e
            investimentos hoje mesmo. Plano gratuito disponível!
          </p>
          <div className="flex flex-col sm:flex-row sm:flex-wrap items-center justify-center gap-4">
            <Link href="/login" className="w-full sm:w-auto">
              <Button size="lg" className="w-full px-8 py-3">
                Criar Conta Grátis
              </Button>
            </Link>
            <Link href="/dashboard/plans" className="w-full sm:w-auto">
              <Button variant="outline" size="lg" className="w-full px-8 py-3">
                Ver Planos
              </Button>
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-muted text-foreground border-t py-8 mt-16">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <TrendingUp className="h-6 w-6" />
            <span className="text-lg font-semibold">PulodoGato</span>
          </div>
          <p className="text-muted-foreground">
            © 2025 PulodoGato. Todos os direitos reservados.
          </p>
        </div>
      </footer>
    </div>
  );
}
