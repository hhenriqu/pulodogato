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
    } catch {
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
      } catch {
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

    // `docs/database-setup.sql` morava nesta lista e NUNCA existiu neste
    // repositorio -- o schema sempre viveu em database/migrations/. Como esta
    // verificacao exige 100%, um arquivo fantasma a mantinha reprovada para
    // sempre; e como ela vem antes do `lint` na cadeia do `pre-commit`, o lint
    // nunca chegava a rodar. Ver HMO-119.
    const requiredDocs = [
      { file: "docs/PRD.md", name: "PRD Principal" },
      { file: "docs/PRD-Governance.md", name: "Governança da PRD" },
      { file: "docs/API-Specification.md", name: "Especificação da API" },
      { file: "database/README.md", name: "Guia do Banco" },
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

    // Esta lista cobrava o app de INVESTIMENTOS que a PRD antiga descrevia:
    // `app/api/assets/route.ts`, `app/api/transactions/route.ts` e um calculo de
    // preco medio, todos com `implemented: false` fixo no codigo -- ou seja,
    // tres regras que jamais poderiam passar, porque descrevem um produto que
    // este repositorio nao construiu. A quarta apontava para
    // `app/signup/page.tsx`, e o cadastro real mora em `app/(auth)/signup/`.
    // Resultado: 0% para sempre. Agora a lista cita as regras de dinheiro da
    // PRD v2.0, nos arquivos onde elas realmente moram.
    const businessRulesChecks = [
      {
        rule: "RN001 - Cadastro e sessão",
        files: ["app/(auth)/signup/page.tsx", "lib/hooks/useAuth.ts"],
        implemented: true,
      },
      {
        rule: "RN002 - Sinal do valor (despesa é negativa)",
        files: ["lib/lancamento.ts"],
        implemented: true,
      },
      {
        rule: "RN003 - Transferência de duas pernas",
        files: ["lib/transferencia.ts"],
        implemented: true,
      },
      {
        rule: "RN004 - Fatura de cartão sem dupla contagem",
        files: ["lib/card-invoice.ts"],
        implemented: true,
      },
      {
        rule: "RN007 - Divisão de despesa em grupo",
        files: ["lib/grupos.ts"],
        implemented: true,
      },
      {
        rule: "RN008 - Acerto do grupo",
        files: ["lib/settlement.ts"],
        implemented: true,
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

    // 100%, nao "pelo menos uma": as seis regras acima JA estao implementadas e
    // tem teste. O valor deste passo e pegar o dia em que uma delas sumir de
    // lugar -- renomear `lib/grupos.ts` sem atualizar quem o cita passa pelo tsc
    // quando o import morre junto, e este passo reclama.
    return compliance >= 100;
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
