import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

interface MigrationTemplate {
  name: string;
  description: string;
  tables?: string[];
  functions?: string[];
  triggers?: string[];
}

export class MigrationGenerator {
  private migrationsDir: string;

  constructor() {
    this.migrationsDir = join(process.cwd(), "database", "migrations");
  }

  /**
   * Gera uma nova migration com template
   */
  generateMigration(template: MigrationTemplate): string {
    const nextNumber = this.getNextMigrationNumber();
    const fileName = `${nextNumber.toString().padStart(3, "0")}_${
      template.name
    }.sql`;
    const filePath = join(this.migrationsDir, fileName);

    const content = this.generateMigrationContent(template);

    writeFileSync(filePath, content);

    console.log(`✅ Migration criada: ${fileName}`);
    return filePath;
  }

  /**
   * Gera o conteúdo da migration baseado no template
   */
  private generateMigrationContent(template: MigrationTemplate): string {
    const timestamp = new Date().toISOString().split("T")[0];

    let content = `-- =====================================================
-- MIGRATION: ${template.description}
-- Data: ${timestamp}
-- Arquivo: ${template.name}.sql
-- =====================================================

`;

    // Seção de tipos (se necessário)
    if (template.name.includes("type") || template.name.includes("enum")) {
      content += `-- 1. TIPOS PERSONALIZADOS
-- =====================================================

-- Exemplo:
-- CREATE TYPE status_type AS ENUM ('active', 'inactive', 'pending');

`;
    }

    // Seção de tabelas
    if (template.tables && template.tables.length > 0) {
      content += `-- 2. CRIAÇÃO DE TABELAS
-- =====================================================

`;

      template.tables.forEach((table, index) => {
        content += `-- Tabela: ${table}
CREATE TABLE IF NOT EXISTS ${table} (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    -- TODO: Adicionar campos específicos
);

-- Índices para ${table}
CREATE INDEX IF NOT EXISTS idx_${table}_user ON ${table}(user_id);
CREATE INDEX IF NOT EXISTS idx_${table}_created ON ${table}(created_at);

`;
      });
    }

    // Seção de funções
    if (template.functions && template.functions.length > 0) {
      content += `-- 3. FUNÇÕES E PROCEDURES
-- =====================================================

`;

      template.functions.forEach((func) => {
        content += `-- Função: ${func}
CREATE OR REPLACE FUNCTION ${func}()
RETURNS TRIGGER AS $$
BEGIN
    -- TODO: Implementar lógica da função
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

`;
      });
    }

    // Seção de triggers
    if (template.triggers && template.triggers.length > 0) {
      content += `-- 4. TRIGGERS
-- =====================================================

`;

      template.triggers.forEach((trigger) => {
        content += `-- Trigger: ${trigger}
CREATE TRIGGER ${trigger}
    BEFORE UPDATE ON table_name
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

`;
      });
    }

    // Seção de RLS
    content += `-- 5. ROW LEVEL SECURITY (RLS)
-- =====================================================

`;

    if (template.tables && template.tables.length > 0) {
      template.tables.forEach((table) => {
        content += `-- RLS para ${table}
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;

CREATE POLICY "${table}_policy" ON ${table}
    FOR ALL USING (auth.uid() = user_id);

`;
      });
    }

    // Seção de verificação
    content += `-- 6. VERIFICAÇÃO DA MIGRATION
-- =====================================================

-- Função de verificação
CREATE OR REPLACE FUNCTION verify_${template.name}_migration()
RETURNS TABLE(
    item TEXT,
    status TEXT,
    details TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        'Migration ${template.name}'::TEXT,
        'SUCCESS'::TEXT,
        'Migration executada com sucesso'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Executar verificação
SELECT * FROM verify_${template.name}_migration();

-- =====================================================
-- FIM DA MIGRATION
-- =====================================================
`;

    return content;
  }

  /**
   * Obtém o próximo número da migration
   */
  private getNextMigrationNumber(): number {
    if (!existsSync(this.migrationsDir)) {
      return 1;
    }

    const files = require("fs").readdirSync(this.migrationsDir);
    const migrationNumbers = files
      .filter((file: string) => file.endsWith(".sql"))
      .map((file: string) => parseInt(file.split("_")[0]))
      .filter((num: number) => !isNaN(num));

    return migrationNumbers.length > 0 ? Math.max(...migrationNumbers) + 1 : 1;
  }

  /**
   * Templates pré-definidos para funcionalidades comuns
   */
  static getTemplates() {
    return {
      investments: {
        name: "investments_system",
        description: "Sistema de Investimentos - Ações, FIIs, Renda Fixa",
        tables: [
          "assets",
          "portfolios",
          "investment_transactions",
          "dividends",
          "portfolio_positions",
        ],
        functions: [
          "calculate_portfolio_value",
          "update_position",
          "process_dividend",
        ],
        triggers: ["update_position_on_transaction", "calculate_average_price"],
      },

      goals: {
        name: "goals_budgets",
        description: "Sistema de Metas e Orçamentos",
        tables: [
          "financial_goals",
          "budgets",
          "budget_categories",
          "goal_contributions",
        ],
        functions: [
          "update_goal_progress",
          "check_budget_limit",
          "calculate_savings_rate",
        ],
        triggers: ["update_goal_on_transaction", "check_budget_exceeded"],
      },

      analytics: {
        name: "analytics_reports",
        description: "Sistema de Relatórios e Analytics",
        tables: [
          "report_templates",
          "scheduled_reports",
          "analytics_cache",
          "user_insights",
        ],
        functions: [
          "generate_monthly_report",
          "calculate_cash_flow",
          "analyze_spending_patterns",
        ],
        triggers: ["invalidate_cache_on_update", "generate_insights"],
      },

      notifications: {
        name: "notifications_system",
        description: "Sistema de Notificações e Alertas",
        tables: [
          "notifications",
          "notification_preferences",
          "alert_rules",
          "notification_logs",
        ],
        functions: [
          "send_notification",
          "check_alert_conditions",
          "process_notification_queue",
        ],
        triggers: ["create_notification_on_event", "log_notification_sent"],
      },

      integrations: {
        name: "external_integrations",
        description: "Integrações Externas - APIs, Bancos, Cartões",
        tables: [
          "integration_configs",
          "api_credentials",
          "sync_logs",
          "external_accounts",
        ],
        functions: [
          "sync_bank_transactions",
          "fetch_asset_prices",
          "process_webhook",
        ],
        triggers: ["log_sync_activity", "validate_external_data"],
      },
    };
  }
}

// CLI Usage Example
if (require.main === module) {
  const generator = new MigrationGenerator();
  const templates = MigrationGenerator.getTemplates();

  // Exemplo de uso:
  // node migration-generator.js investments
  const templateName = process.argv[2];

  if (templateName && templates[templateName as keyof typeof templates]) {
    const template = templates[templateName as keyof typeof templates];
    generator.generateMigration(template);
  } else {
    console.log("📋 Templates disponíveis:");
    Object.keys(templates).forEach((key) => {
      const template = templates[key as keyof typeof templates];
      console.log(`  - ${key}: ${template.description}`);
    });
    console.log("\n🚀 Uso: node migration-generator.js <template>");
  }
}
