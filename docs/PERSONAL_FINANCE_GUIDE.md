# 💰 Sistema de Finanças Pessoais

## 🎯 Funcionalidades Implementadas

### ✅ Recursos Disponíveis

- **💸 Gestão de Finanças Pessoais**

  - Controle de receitas e despesas
  - Categorização automática de lançamentos
  - Interface intuitiva para entrada de dados

- **🤝 Divisão de Gastos Inteligente**

  - Compartilhamento de despesas com conexões
  - Definição de percentuais personalizados
  - Sistema de aprovação automática
  - Cálculo automático de valores individuais

- **📊 Metas Financeiras**

  - Definição de objetivos financeiros
  - Acompanhamento visual do progresso
  - Cálculo automático de economia necessária

- **⚖️ Controle de Saldos**
  - Balanço automático entre usuários
  - Histórico de transações compartilhadas
  - Liquidação simplificada de dívidas

## 🚀 Como Configurar

### 1. Configurar Banco de Dados

1. **Acesse o Supabase Dashboard**: https://supabase.com/dashboard
2. **Navegue até SQL Editor**
3. **Execute o script de migração**:

   ```sql
   -- Cole o conteúdo completo do arquivo:
   -- database/migrations/002_personal_finance.sql
   ```

4. **Verifique a instalação**:
   ```sql
   -- Cole o conteúdo do arquivo:
   -- database/check_setup.sql
   ```

### 2. Verificar Configuração do Projeto

1. **Copie o arquivo de ambiente**:

   ```bash
   cp .env.example .env.local
   ```

2. **Configure as variáveis do Supabase**:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=sua_url_do_supabase
   NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_chave_anonima
   ```

## 📱 Como Usar

### 💰 Finanças Pessoais

1. **Acesse**: Dashboard → Finanças
2. **Novo Lançamento**: Clique em "Novo Lançamento"
3. **Preencha os dados**:
   - Descrição (ex: "Jantar no restaurante")
   - Valor (ex: 120,00)
   - Categoria (ex: "Alimentação")
   - Data da transação

### 🤝 Divisão de Gastos

1. **Marque "Dividir este gasto"** (apenas para despesas)
2. **Selecione as conexões** para dividir
3. **Defina os percentuais**:
   - Exemplo: Você 60%, Amigo 40%
   - Total deve somar 100%
4. **Salve a transação**

#### Exemplo Prático:

```
Compra: Bolsa - R$ 100,00
Divisão: Você (60%) + Laís (40%)
Resultado: Você paga R$ 60,00, Laís deve R$ 40,00
```

### 🎯 Metas Financeiras

1. **Acesse**: Dashboard → Metas
2. **Criar Nova Meta**: Defina objetivo e prazo
3. **Acompanhe o progresso** visualmente
4. **Receba sugestões** de economia diária

## 🏗️ Estrutura do Sistema

### 📊 Banco de Dados

- **financial_services**: Tipos de serviços (Finanças, Investimentos, Metas)
- **transaction_categories**: Categorias de lançamentos
- **financial_transactions**: Transações financeiras principais
- **expense_splits**: Divisões de gastos entre usuários
- **user_balances**: Saldos entre usuários (calculado automaticamente)

### 🔐 Segurança

- **Row Level Security (RLS)** ativado em todas as tabelas
- **Políticas de acesso** que garantem que usuários só vejam seus dados
- **Validações automáticas** de integridade dos dados
- **Triggers** para cálculos automáticos de saldos

### ⚡ Automações

- **Cálculo automático** de valores das divisões baseado em percentuais
- **Atualização automática** de saldos entre usuários
- **Validação** de percentuais (deve somar 100%)
- **Status tracking** das aprovações de gastos

## 🎨 Interface

### 📱 Componentes Implementados

- **Cards de resumo** com totais de receitas/despesas
- **Formulário intuitivo** para novos lançamentos
- **Seletor de conexões** com avatares
- **Controle de percentuais** com validação em tempo real
- **Lista de transações** com status de compartilhamento
- **Progress bars** para metas financeiras

### 🎯 UX/UI Features

- **Validação em tempo real** de formulários
- **Feedback visual** para ações do usuário
- **Responsivo** para mobile e desktop
- **Cores semânticas** (verde para receitas, vermelho para despesas)
- **Badges** para indicar status de compartilhamento

## 🔄 Próximos Passos

### 🚧 Melhorias Planejadas

1. **Sistema de Notificações**

   - Alertas de gastos compartilhados pendentes
   - Lembretes de metas próximas ao vencimento

2. **Relatórios Avançados**

   - Gráficos de gastos por categoria
   - Análise de tendências mensais
   - Comparação entre metas e realizado

3. **Integração com Bancos**

   - Importação automática de extratos
   - Categorização inteligente com ML

4. **Sistema de Aprovação Refinado**
   - Comentários nas divisões
   - Histórico de aprovações/rejeições
   - Timeout automático para aprovações

## 💡 Dicas de Uso

### 🎯 Boas Práticas

- **Categorize sempre** suas transações para melhor controle
- **Use a divisão** em gastos compartilhados para evitar conflitos
- **Defina metas realistas** com prazos atingíveis
- **Revise regularmente** seus gastos por categoria

### 📈 Maximizando o Uso

1. **Conecte-se** com pessoas que dividem gastos frequentemente
2. **Configure metas** para seus objetivos principais
3. **Use categorias específicas** para melhor análise
4. **Acompanhe o progresso** semanalmente

## 🆘 Solução de Problemas

### ❗ Problemas Comuns

- **Erro ao salvar transação**: Verifique se todos os campos estão preenchidos
- **Percentuais não somam 100%**: Ajuste os valores antes de salvar
- **Conexão não aparece**: Certifique-se que a conexão foi aceita

### 🔧 Suporte Técnico

- **Logs de erro**: Verifique o console do navegador (F12)
- **Dados não carregam**: Verifique a configuração do Supabase
- **Performance lenta**: Limpe o cache do navegador

---

🎉 **Parabéns!** Agora você tem um sistema completo de finanças pessoais com divisão inteligente de gastos!

💬 Para dúvidas ou sugestões, consulte a documentação técnica ou entre em contato.
