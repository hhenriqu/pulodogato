# 🗄️ **Sistema de Migrações - Estratégia de Desenvolvimento**

## 📋 **Processo Atual (Database-First)**

### **✅ Vantagens da Abordagem Atual:**

1. **Integridade Garantida:** Constraints e validações no banco
2. **Performance Otimizada:** Índices e estruturas pensadas desde o início
3. **Auditoria Completa:** Triggers e logs automáticos
4. **Escalabilidade:** Base sólida para crescimento
5. **Consistência:** Regras de negócio centralizadas

### **🔄 Fluxo de Desenvolvimento:**

```mermaid
graph LR
    A[Nova Funcionalidade] --> B[Definir Schema]
    B --> C[Criar Migration]
    C --> D[Testar Localmente]
    D --> E[Deploy Incremental]
    E --> F[Desenvolver API]
    F --> G[Criar Interface]
```

## 🏗️ **Estrutura de Migrações**

### **Migrations Atuais:**

```
database/migrations/
├── 000_preflight_inventory.sql      → inventário somente leitura, roda antes
├── 001_baseline.sql                 → Schema completo (GERADO, não editar à mão)
├── 002_rls_lockdown.sql             → RLS e privilégios (obrigatório)
└── 003_fix_trigger_privileges.sql   → SECURITY DEFINER nos triggers (obrigatório)
```

Ordem de aplicação: `001` → `002` → `003`. Parar no `001` deixa o banco aberto;
parar no `002` quebra o cadastro e a aprovação de divisões. O seed de referência
vive fora do baseline, em `database/seed/reference_data.sql`.

> **Correção (2026-09-18).** Versões anteriores deste documento listavam
> `001_initial_setup.sql`, `002_personal_finance.sql`, `003_expense_groups.sql`
> e `004_financial_extensions.sql` como "migrations atuais". **Esses arquivos
> nunca existiram no repositório** — o schema só existia no banco de produção.

> **Atualização (2026-09-21).** O `001_baseline.sql` deixou de ser uma
> reconstrução: hoje é **gerado por `scripts/gen-baseline.mjs` a partir de um
> `pg_dump --schema-only` do banco de produção** e foi validado subindo do zero
> num projeto Supabase limpo. Não edite o arquivo à mão — para mudar o schema,
> escreva uma migration nova (`004_...`), aplique e regenere o baseline.
> `database/README.md` tem o procedimento e as evidências.

### **Convenções de Naming:**

```
{número}_{nome_descritivo}.sql
- Número: 3 dígitos sequenciais
- Nome: snake_case, descritivo
- Conteúdo: Uma funcionalidade por migration
```

## 🎯 **Estratégias Recomendadas**

### **1. Database-First (Atual) ✅**

**Ideal para:** Sistemas financeiros, e-commerce, ERP

```sql
-- Exemplo: Nova funcionalidade de metas
-- 1º: Criar migration
CREATE TABLE financial_goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  target_amount DECIMAL(15,2) NOT NULL,
  current_amount DECIMAL(15,2) DEFAULT 0,
  deadline DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2º: Desenvolver APIs
-- 3º: Criar interface
```

### **2. Schema Evolution (Híbrido)**

**Para funcionalidades experimentais:**

```typescript
// Desenvolver com mock data
const mockGoals = [{ id: 1, name: "Casa Própria", target: 200000 }];

// Após validação: migrar para banco
// CREATE TABLE financial_goals...
```

## 🔧 **Ferramentas de Apoio**

> **Correção (2026-09-21).** Esta seção descrevia três ferramentas que **não
> existem no repositório**: `npm run migration:create` (não há esse script no
> `package.json`), `verify_schema_integrity()` (função inexistente) e um
> "rollback system" com seções `DOWN` (nenhuma migration tem). Abaixo está o
> que de fato existe e roda.

### **1. Criar uma migration nova**

Não há gerador conectado. Crie o arquivo à mão em `database/migrations/`
seguindo a convenção de naming acima (`004_...`) e aplique com `psql`.
Depois regenere o baseline:

```bash
node scripts/gen-baseline.mjs   # a partir de um pg_dump --schema-only de produção
```

### **2. Validar o schema**

```bash
# Postgres cru (o mesmo que o CI roda a cada PR que toca database/)
psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/tests/schema_prereq_test.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/tests/rls_isolation_test.sql

# Projeto Supabase: cole os arquivos de database/validation/ no SQL Editor
```

### **3. Reverter**

Não há `DOWN` por migration. A rede de segurança é o par
`scripts/db-backup.sh` / `scripts/db-restore.sh` — o restore se recusa a
apontar para produção e confere o destino antes de apagar qualquer coisa.
Leia `database/README.md` antes de usá-lo.

## 📊 **Comparação de Abordagens**

| Aspecto              | Database-First | Code-First | Schema-Last |
| -------------------- | -------------- | ---------- | ----------- |
| **Integridade**      | ⭐⭐⭐⭐⭐     | ⭐⭐⭐     | ⭐          |
| **Performance**      | ⭐⭐⭐⭐⭐     | ⭐⭐⭐     | ⭐⭐        |
| **Flexibilidade**    | ⭐⭐⭐         | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐  |
| **Manutenibilidade** | ⭐⭐⭐⭐⭐     | ⭐⭐⭐⭐   | ⭐          |
| **Segurança**        | ⭐⭐⭐⭐⭐     | ⭐⭐⭐     | ⭐⭐        |

## 🎯 **Recomendação Final**

### **✅ Mantenha Database-First para:**

- Transações financeiras
- Dados críticos do negócio
- Funcionalidades core
- Relatórios e analytics

### **🔄 Use Híbrido para:**

- Funcionalidades experimentais
- Prototipação rápida
- A/B testing
- Features temporárias

## 🚀 **Próximos Passos**

1. **Executar migrações atuais**
2. **Definir roadmap de funcionalidades**
3. **Criar migrations incrementais**
4. **Implementar sistema de rollback**
5. **Automatizar deployment de schema**

---

**💡 Conclusão:** Database-First é a melhor abordagem para sistemas financeiros pela segurança, performance e integridade de dados que oferece.
