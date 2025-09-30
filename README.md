# 🏦 Controle de Investimentos

Um aplicativo Progressive Web App (PWA) para controle e acompanhamento de investimentos financeiros, desenvolvido com Next.js 14, Supabase e TypeScript.

## 🚀 Funcionalidades

- **Dashboard Completo**: Visão geral da carteira com métricas em tempo real
- **Gestão de Investimentos**: Controle de ações, FIIs, renda fixa e internacionais
- **Registro de Transações**: Compra, venda e dividendos
- **Gráficos Interativos**: Performance e alocação de ativos
- **Cálculo Automático**: Preço médio e rentabilidade
- **PWA**: Funciona offline e pode ser instalado no smartphone
- **Responsivo**: Interface adaptada para desktop e mobile

## 🛠️ Stack Técnica

- **Frontend**: Next.js 14 (App Router) + TypeScript
- **Database**: Supabase (PostgreSQL)
- **Styling**: Tailwind CSS
- **Authentication**: Supabase Auth
- **PWA**: Next-PWA
- **Icons**: Lucide React
- **Charts**: Recharts
- **Forms**: React Hook Form + Zod

## 📦 Instalação

### Pré-requisitos

- Node.js 18+
- npm ou yarn
- Conta no [Supabase](https://supabase.com/)

### 1. Clone o repositório

```bash
git clone https://github.com/your-username/investment-tracker.git
cd investment-tracker
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Configuração do Supabase

1. Crie um novo projeto no [Supabase](https://supabase.com/)
2. Copie o arquivo `.env.local.example` para `.env.local`
3. Preencha as variáveis de ambiente:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 4. Execute as migrações do banco

Execute os seguintes comandos SQL no editor SQL do Supabase:

```sql
-- Tabela de perfis de usuário
CREATE TABLE profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (id)
);

-- Tabela de ativos
CREATE TABLE assets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('stock', 'fii', 'fixed_income', 'international')),
  currency TEXT NOT NULL DEFAULT 'BRL',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de transações
CREATE TABLE transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  asset_id UUID REFERENCES assets ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('buy', 'sell', 'dividend')),
  quantity DECIMAL(15,2) NOT NULL,
  price DECIMAL(15,2) NOT NULL,
  fees DECIMAL(15,2) DEFAULT 0,
  date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de dividendos
CREATE TABLE dividends (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  asset_id UUID REFERENCES assets ON DELETE CASCADE NOT NULL,
  amount_per_share DECIMAL(15,4) NOT NULL,
  quantity DECIMAL(15,2) NOT NULL,
  payment_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Políticas RLS (Row Level Security)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividends ENABLE ROW LEVEL SECURITY;

-- Políticas para profiles
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Políticas para transactions
CREATE POLICY "Users can view own transactions" ON transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own transactions" ON transactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own transactions" ON transactions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own transactions" ON transactions FOR DELETE USING (auth.uid() = user_id);

-- Políticas para dividends
CREATE POLICY "Users can view own dividends" ON dividends FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own dividends" ON dividends FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own dividends" ON dividends FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own dividends" ON dividends FOR DELETE USING (auth.uid() = user_id);

-- Assets são públicos para leitura
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Assets are viewable by everyone" ON assets FOR SELECT USING (true);
```

### 5. Insira alguns ativos de exemplo

```sql
INSERT INTO assets (symbol, name, type, currency) VALUES
('PETR4', 'Petrobras ON', 'stock', 'BRL'),
('VALE3', 'Vale ON', 'stock', 'BRL'),
('ITUB4', 'Itaú Unibanco ON', 'stock', 'BRL'),
('BBDC4', 'Bradesco ON', 'stock', 'BRL'),
('HGLG11', 'CSHG Logística FII', 'fii', 'BRL'),
('KNRI11', 'Kinea Renda Imobiliária FII', 'fii', 'BRL');
```

## 🚀 Execução

### Desenvolvimento

```bash
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000) no seu navegador.

### Produção

```bash
npm run build
npm start
```

## 📱 PWA Features

O aplicativo funciona como uma Progressive Web App:

- **Instalável**: Pode ser instalado no smartphone
- **Offline**: Funcionalidades básicas disponíveis offline
- **Push Notifications**: (implementar se necessário)
- **Responsivo**: Interface adaptada para todos os dispositivos

## 🎨 Estrutura do Projeto

```
/
├── app/                    # Next.js App Router
│   ├── dashboard/          # Páginas do dashboard
│   ├── api/               # API Routes
│   └── login/             # Autenticação
├── components/            # Componentes React
│   ├── ui/               # Componentes de UI base
│   ├── charts/           # Componentes de gráficos
│   └── forms/            # Componentes de formulários
├── lib/                  # Utilitários e configurações
├── types/                # Definições TypeScript
├── utils/                # Utilitários gerais
└── public/               # Assets estáticos e PWA
```

## 🔧 Scripts Disponíveis

- `npm run dev` - Executa em modo desenvolvimento
- `npm run build` - Build para produção
- `npm run start` - Executa em modo produção
- `npm run lint` - Executa o linter

## 📊 Funcionalidades Detalhadas

### Dashboard

- Resumo patrimonial com cards informativos
- Gráfico de pizza para alocação de ativos
- Gráfico de linha para performance vs benchmark
- Tabela detalhada da carteira

### Transações

- Formulário para registro de compra/venda
- Histórico completo de transações
- Cálculo automático de preço médio
- Registro de dividendos

### Relatórios

- Performance por período
- Análise de alocação
- Histórico de dividendos
- Exportação para Excel/PDF

## 🔒 Segurança

- Autenticação via Supabase Auth
- Row Level Security (RLS) no banco
- Validação de dados com Zod
- Proteção de rotas

## 🌐 Deploy

### Vercel (Recomendado)

1. Conecte o repositório ao Vercel
2. Configure as variáveis de ambiente
3. Deploy automático

### Outras plataformas

O projeto é compatível com qualquer plataforma que suporte Next.js:

- Netlify
- Railway
- Heroku
- AWS Amplify

## 📝 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

## 🤝 Contribuição

Contribuições são bem-vindas! Por favor, leia o guia de contribuição antes de submeter PRs.

## 📞 Suporte

Para dúvidas ou suporte, abra uma issue no GitHub ou entre em contato.

---

Desenvolvido com ❤️ usando Next.js e Supabase
# pulodogato
