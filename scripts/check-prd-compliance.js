#!/usr/bin/env node

/**
 * PRD Compliance Checker
 * Verifica se o desenvolvimento está seguindo as especificações da PRD
 */

const fs = require("fs");
const path = require("path");

class PRDComplianceChecker {
  constructor() {
    this.projectRoot = process.cwd();
    this.config = this.loadProjectConfig();
    this.results = {
      architecture: [],
      businessRules: [],
      fileStructure: [],
      documentation: [],
    };
  }

  loadProjectConfig() {
    try {
      const configPath = path.join(this.projectRoot, "project-config.json");
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (error) {
      console.error("❌ Erro ao carregar project-config.json");
      process.exit(1);
    }
  }

  checkFileStructure() {
    console.log("\n📁 Verificando Estrutura de Arquivos...");

    const expectedStructure = [
      "app",
      "app/(auth)",
      "app/(dashboard)",
      "app/api",
      "components",
      "components/ui",
      "components/dashboard",
      "lib",
      "lib/hooks",
      "types",
      "utils",
      "docs",
      "public",
    ];

    let score = 0;

    expectedStructure.forEach((dir) => {
      const fullPath = path.join(this.projectRoot, dir);
      if (fs.existsSync(fullPath)) {
        console.log(`  ✅ ${dir}`);
        score++;
      } else {
        console.log(`  ❌ ${dir} - Não encontrado`);
        this.results.fileStructure.push(`Missing: ${dir}`);
      }
    });

    const compliance = (score / expectedStructure.length) * 100;
    console.log(
      `\n📊 Estrutura de Arquivos: ${compliance.toFixed(1)}% conforme PRD`
    );

    return compliance >= 80;
  }

  checkArchitecture() {
    console.log("\n🏗️ Verificando Arquitetura...");

    const checks = [
      {
        name: "Next.js 14 App Router",
        check: () => {
          const packageJson = JSON.parse(
            fs.readFileSync("package.json", "utf8")
          );
          return (
            packageJson.dependencies.next &&
            packageJson.dependencies.next.startsWith("14")
          );
        },
      },
      {
        name: "TypeScript configurado",
        check: () => fs.existsSync("tsconfig.json"),
      },
      {
        name: "Tailwind CSS",
        check: () => {
          const packageJson = JSON.parse(
            fs.readFileSync("package.json", "utf8")
          );
          return (
            packageJson.devDependencies?.tailwindcss ||
            packageJson.dependencies?.tailwindcss
          );
        },
      },
      {
        name: "Supabase cliente",
        check: () => {
          const packageJson = JSON.parse(
            fs.readFileSync("package.json", "utf8")
          );
          return packageJson.dependencies["@supabase/supabase-js"];
        },
      },
      {
        name: "PWA configurado",
        check: () => {
          const packageJson = JSON.parse(
            fs.readFileSync("package.json", "utf8")
          );
          return (
            packageJson.dependencies["next-pwa"] &&
            fs.existsSync("public/manifest.json")
          );
        },
      },
      {
        name: "React Hook Form + Zod",
        check: () => {
          const packageJson = JSON.parse(
            fs.readFileSync("package.json", "utf8")
          );
          return (
            packageJson.dependencies["react-hook-form"] &&
            packageJson.dependencies.zod
          );
        },
      },
    ];

    let passed = 0;

    checks.forEach(({ name, check }) => {
      try {
        if (check()) {
          console.log(`  ✅ ${name}`);
          passed++;
        } else {
          console.log(`  ❌ ${name}`);
          this.results.architecture.push(`Missing: ${name}`);
        }
      } catch (error) {
        console.log(`  ❌ ${name} - Erro na verificação`);
        this.results.architecture.push(`Error checking: ${name}`);
      }
    });

    const compliance = (passed / checks.length) * 100;
    console.log(`\n📊 Arquitetura: ${compliance.toFixed(1)}% conforme PRD`);

    return compliance >= 90;
  }

  checkDocumentation() {
    console.log("\n📚 Verificando Documentação...");

    const requiredDocs = [
      { file: "docs/PRD.md", name: "PRD Principal" },
      { file: "docs/PRD-Governance.md", name: "Governança da PRD" },
      { file: "docs/API-Specification.md", name: "Especificação da API" },
      { file: "docs/database-setup.sql", name: "Script do Banco" },
      { file: "README.md", name: "README do Projeto" },
    ];

    let found = 0;

    requiredDocs.forEach(({ file, name }) => {
      if (fs.existsSync(path.join(this.projectRoot, file))) {
        console.log(`  ✅ ${name}`);
        found++;
      } else {
        console.log(`  ❌ ${name} - ${file}`);
        this.results.documentation.push(`Missing: ${file}`);
      }
    });

    const compliance = (found / requiredDocs.length) * 100;
    console.log(`\n📊 Documentação: ${compliance.toFixed(1)}% completa`);

    return compliance >= 100;
  }

  checkBusinessRulesImplementation() {
    console.log("\n⚖️ Verificando Implementação das Regras de Negócio...");

    const businessRulesChecks = [
      {
        rule: "RN001 - Cadastro de Usuário",
        files: ["app/signup/page.tsx", "lib/hooks/useAuth.ts"],
        implemented: true,
      },
      {
        rule: "RN002 - Gestão de Ativos",
        files: ["app/api/assets/route.ts"],
        implemented: false,
      },
      {
        rule: "RN003 - Transações",
        files: ["app/api/transactions/route.ts"],
        implemented: false,
      },
      {
        rule: "RN004 - Cálculo de Preço Médio",
        files: ["lib/utils/calculations.ts"],
        implemented: false,
      },
    ];

    let implemented = 0;

    businessRulesChecks.forEach(
      ({ rule, files, implemented: isImplemented }) => {
        if (
          isImplemented &&
          files.every((file) =>
            fs.existsSync(path.join(this.projectRoot, file))
          )
        ) {
          console.log(`  ✅ ${rule}`);
          implemented++;
        } else {
          console.log(`  ⏳ ${rule} - Pendente`);
          this.results.businessRules.push(`Pending: ${rule}`);
        }
      }
    );

    const compliance = (implemented / businessRulesChecks.length) * 100;
    console.log(
      `\n📊 Regras de Negócio: ${compliance.toFixed(1)}% implementadas`
    );

    return compliance >= 25; // Pelo menos 1 de 4 implementada
  }

  generateReport() {
    console.log("\n" + "=".repeat(60));
    console.log("📋 RELATÓRIO DE CONFORMIDADE COM A PRD");
    console.log("=".repeat(60));

    const architectureOk = this.checkArchitecture();
    const structureOk = this.checkFileStructure();
    const docsOk = this.checkDocumentation();
    const businessRulesOk = this.checkBusinessRulesImplementation();

    console.log("\n📊 RESUMO GERAL:");
    console.log(`  Arquitetura: ${architectureOk ? "✅" : "❌"}`);
    console.log(`  Estrutura: ${structureOk ? "✅" : "❌"}`);
    console.log(`  Documentação: ${docsOk ? "✅" : "❌"}`);
    console.log(`  Regras de Negócio: ${businessRulesOk ? "✅" : "❌"}`);

    const overallCompliance =
      architectureOk && structureOk && docsOk && businessRulesOk;

    console.log("\n" + "=".repeat(60));
    if (overallCompliance) {
      console.log("🎉 PROJETO EM CONFORMIDADE COM A PRD!");
    } else {
      console.log("⚠️  PROJETO PRECISA DE AJUSTES PARA CONFORMIDADE");
      this.showRecommendations();
    }
    console.log("=".repeat(60));

    return overallCompliance;
  }

  showRecommendations() {
    console.log("\n🔧 RECOMENDAÇÕES:");

    if (this.results.architecture.length > 0) {
      console.log("\n  Arquitetura:");
      this.results.architecture.forEach((issue) =>
        console.log(`    • ${issue}`)
      );
    }

    if (this.results.fileStructure.length > 0) {
      console.log("\n  Estrutura de Arquivos:");
      this.results.fileStructure.forEach((issue) =>
        console.log(`    • ${issue}`)
      );
    }

    if (this.results.businessRules.length > 0) {
      console.log("\n  Regras de Negócio:");
      this.results.businessRules.forEach((issue) =>
        console.log(`    • ${issue}`)
      );
    }

    console.log(
      "\n💡 Consulte a PRD em ./docs/PRD.md para implementação correta."
    );
  }

  run() {
    console.log(
      "🔍 Verificando conformidade com a PRD v" + this.config.project.prdVersion
    );
    console.log("📁 Projeto:", this.config.project.name);

    return this.generateReport();
  }
}

// Executar verificação
if (require.main === module) {
  const checker = new PRDComplianceChecker();
  const compliant = checker.run();
  process.exit(compliant ? 0 : 1);
}

module.exports = PRDComplianceChecker;
