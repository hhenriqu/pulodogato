#!/usr/bin/env node
// =====================================================
// PULODOGATO - MUTACOES DA TRANSFERENCIA RECORRENTE (HMO-172)
// =====================================================
//   npm run mutantes:transferencia-recorrente-app
//
// Estraga UMA decisao por vez em `lib/transferencia.ts` e em
// `lib/services/scheduled.ts`, e exige que a suite correspondente fique
// VERMELHA. Uma mutacao que sobrevive nao diz que o codigo esta certo: diz que
// o teste nao olha para aquela linha.
//
// Separado de `mutantes-transferencia.mjs` (HMO-164, 12/12) porque sao duas
// perguntas diferentes: aquele cobre as pernas e a validacao das contas; este
// cobre a RECORRENCIA -- a regra, os campos da tela, a baixa em duas pernas e a
// materializacao. Juntar os dois faria uma rodada de 25 mutacoes vezes duas
// suites para medir coisas que falham por motivos separados.
//
// O MUTANTE QUE E O DEFEITO DA ISSUE
// ----------------------------------
// `materializacao_sem_destino` e literalmente o titulo da HMO-172: a ocorrencia
// nasce sem `destination_account_id` e a baixa grava UMA perna. Ele existe para
// provar que a suite da materializacao pega exatamente isso -- e
// `baixa_aceita_sem_destino` e o par dele do outro lado, na guarda que recusa
// antes da primeira escrita.
//
// CUIDADO AO RODAR: este script MUTA OS ARQUIVOS NO DISCO e os restaura no fim.
// Commite antes. Se o processo morrer no meio, `git status` mostra o arquivo
// mutado e `git checkout --` o arquivo o devolve.
// =====================================================

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const TRANSFERENCIA = "lib/transferencia.ts";
const SCHEDULED = "lib/services/scheduled.ts";

const originais = {
  [TRANSFERENCIA]: readFileSync(TRANSFERENCIA, "utf8"),
  [SCHEDULED]: readFileSync(SCHEDULED, "utf8"),
};

/** `suite` e o npm script que tem de ficar vermelho. */
const MUTACOES = [
  // -------------------------------------------------------------------------
  // A REGRA
  // -------------------------------------------------------------------------
  {
    nome: "origem e destino TROCADOS na regra",
    porque:
      "a transferencia anda para tras todo mes. Nenhuma trava pega: o CHECK da 038 so exige que sejam diferentes",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: `    account_id: valores.origemId,
    destination_account_id: valores.destinoId,`,
    para: `    account_id: valores.destinoId,
    destination_account_id: valores.origemId,`,
  },
  {
    nome: "regra sem Math.abs no valor",
    porque:
      "o input aceita '-1000' e a regra levaria valor negativo: CHECK (amount > 0) recusa, e a tela mostra 'nao foi possivel criar' sem dizer por que",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: "    amount: Math.abs(Number.parseFloat(valores.valor)),\n    // A categoria reservada do 023",
    para: "    amount: Number.parseFloat(valores.valor),\n    // A categoria reservada do 023",
  },
  {
    nome: "regra nasce como expense",
    porque:
      "a baixa le o TIPO para saber que ha duas pernas: como 'expense' ela grava UMA perna negativa e nada acusa",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: '    transaction_type: "transfer",\n    frequency: "monthly",',
    para: '    transaction_type: "expense" as "transfer",\n    frequency: "monthly",',
  },
  {
    nome: "regra leva o grupo da tela",
    porque:
      "os triggers de grupo rateiam cada ocorrencia, cobrando dos outros membros um valor que eles ja rateiam nas COMPRAS",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: "    group_id: null,\n  };\n}\n\n/** Por que esta ocorrencia prevista nao pode virar transferencia. */",
    para: "    group_id: (valores as unknown as { grupoId: string }).grupoId ?? null,\n  };\n}\n\n/** Por que esta ocorrencia prevista nao pode virar transferencia. */",
  },
  {
    nome: "duracao contada vira 0 em vez de NULL",
    porque:
      "0 nao e 'sem fim' -- CHECK (max_occurrences > 0) recusa, e NULL e o unico valor que a 005 le como sem fim",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: '      valores.duracao === "contada" ? Number(valores.mesesDeRepeticao) : null,\n    notes:',
    para: '      valores.duracao === "contada" ? Number(valores.mesesDeRepeticao) : 0,\n    notes:',
  },

  // -------------------------------------------------------------------------
  // OS CAMPOS E O DESTINO DA TELA
  // -------------------------------------------------------------------------
  {
    nome: "duracao DESCOLADA do dia do vencimento",
    porque:
      "a pessoa diz 'por 12 meses' sem dizer QUANDO, e a regra nasce com due_day nulo -- uma agenda que nunca gera ocorrencia",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: "  return { natureza: true, diaDeVencimento: fixa, duracao: fixa };",
    para: "  return { natureza: true, diaDeVencimento: fixa, duracao: true };",
  },
  {
    nome: "fixa cai em transacao",
    porque:
      "a transferencia fixa move o dinheiro UMA vez e a pessoa acha que agendou todo mes",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: `  return camposDaTransferencia(valores).diaDeVencimento &&
    valores.natureza === "fixed"
    ? "regra"
    : "transacao";`,
    para: '  return "transacao";',
  },
  {
    nome: "pontual cai em regra",
    porque:
      "quem transfere uma vez nao move dinheiro nenhum hoje e passa a mover todo mes",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: `  return camposDaTransferencia(valores).diaDeVencimento &&
    valores.natureza === "fixed"
    ? "regra"
    : "transacao";`,
    para: '  return "regra";',
  },

  // -------------------------------------------------------------------------
  // A VALIDACAO DA TELA
  // -------------------------------------------------------------------------
  {
    nome: "dia do vencimento aceita qualquer numero",
    porque:
      "due_day 32 leva 23514 do CHECK da 005, sem traducao para o usuario",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: "    if (!Number.isInteger(dia) || dia < 1 || dia > 31) {",
    para: "    if (false) {",
  },
  {
    nome: "meses de repeticao aceita zero",
    porque:
      "max_occurrences 0 e recusado pelo CHECK, e aceito aqui viraria uma regra que nunca gera ocorrencia",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: "    if (!Number.isInteger(meses) || meses < 1 || meses > MAX_MESES_DE_REPETICAO) {",
    para: "    if (false) {",
  },
  {
    nome: "validacao da recorrencia ignora os campos da tela",
    porque:
      "cobra o dia do vencimento numa transferencia PONTUAL: um erro que a pessoa nao tem como consertar, porque o campo nao esta na tela",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: "  if (campos.diaDeVencimento) {\n    const dia = Number(valores.diaDeVencimento);",
    para: "  if (true) {\n    const dia = Number(valores.diaDeVencimento);",
  },

  // -------------------------------------------------------------------------
  // A GUARDA DA BAIXA
  // -------------------------------------------------------------------------
  {
    nome: "baixa_aceita_sem_destino",
    porque:
      "O DEFEITO DA ISSUE, pelo lado da baixa: sem destino a rota grava a perna de SAIDA e so falha no passo seguinte -- metade de uma transferencia no saldo",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: '  if (!conta.destination_account_id) return "sem_destino";',
    para: "",
  },
  {
    nome: "baixa aceita destino igual a origem",
    porque:
      "as duas pernas caem na mesma conta, se anulam, e a tela diz 'Transferencia confirmada' sem nada ter se movido",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: '  if (conta.account_id === conta.destination_account_id) return "mesma_conta";',
    para: "",
  },
  {
    nome: "guarda da baixa recusa TUDO",
    porque:
      "a trava larga demais: nenhuma transferencia prevista pode mais ser confirmada. Morre pelo controle positivo, nao pelas assercoes de recusa",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: '  if (!conta.account_id) return "sem_origem";',
    para: '  if (true) return "sem_origem";',
  },
  {
    nome: "uma mensagem para os tres estados da baixa",
    porque:
      "o usuario repete a mentira de volta: 'nao diz para qual conta vai' numa linha cujo problema e destino = origem",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: '    case "sem_origem":\n      return "Esta transferência prevista não diz de qual conta o dinheiro sai. Edite-a antes de confirmar.";',
    para: '    case "sem_origem":\n      return "Esta transferência prevista não diz para qual conta o dinheiro vai. Edite-a antes de confirmar.";',
  },

  // -------------------------------------------------------------------------
  // A MATERIALIZACAO
  // -------------------------------------------------------------------------
  {
    nome: "materializacao_sem_destino",
    porque:
      "O DEFEITO DA ISSUE, pelo lado da agenda: a ocorrencia nasce sem destino e a baixa nao tem para onde mandar o dinheiro",
    alvo: SCHEDULED,
    suite: "test:materializacao",
    de: `            transaction_type: "transfer" as const,
            destination_account_id: regra.destination_account_id ?? null,`,
    para: '            transaction_type: "transfer" as const,',
  },
  {
    nome: "materializacao sem o transaction_type explicito",
    porque:
      "a ocorrencia cai no ramo do CHECK da 038 que PROIBE destino, e o INSERT leva 23514 -- a agenda fica vazia sem erro na tela",
    alvo: SCHEDULED,
    suite: "test:materializacao",
    de: `            transaction_type: "transfer" as const,
            destination_account_id: regra.destination_account_id ?? null,`,
    para: "            destination_account_id: regra.destination_account_id ?? null,",
  },
  {
    nome: "materializacao grava o tipo em TODA ocorrencia",
    porque:
      "congela a direcao: editar a regra de despesa para receita deixa de reapontar as ocorrencias futuras, que e o que o NULL da 027 existe para permitir",
    alvo: SCHEDULED,
    suite: "test:materializacao",
    de: '      ...(regra.transaction_type === "transfer"',
    para: '      ...(true || regra.transaction_type === "transfer"',
  },
  {
    nome: "materializacao manda destino em toda ocorrencia",
    porque:
      "destino em despesa/receita e a transferencia disfarcada que o CHECK da 038 recusa",
    alvo: SCHEDULED,
    suite: "test:materializacao",
    de: `      ...(regra.transaction_type === "transfer"
        ? {
            transaction_type: "transfer" as const,
            destination_account_id: regra.destination_account_id ?? null,
          }
        : {}),`,
    para: `      ...(regra.transaction_type === "transfer"
        ? { transaction_type: "transfer" as const }
        : {}),
      destination_account_id: regra.destination_account_id ?? null,`,
  },

  // -------------------------------------------------------------------------
  // OS CAMPOS DE DESTINO NA REGRA (HMO-236)
  // -------------------------------------------------------------------------
  // O par do mutante acima, um nivel acima: o de cima estraga a OCORRENCIA, e
  // estes estragam a REGRA de que a ocorrencia nasce.
  {
    nome: "regra manda destino em TODO tipo (a condicao removida)",
    porque:
      "e o defeito que a HMO-236 pediu para travar: em banco sem a 038 colada, a coluna no INSERT faz o PostgREST recusar com PGRST204 ANTES de permissao e de RLS -- nenhuma despesa nem receita fixa pode ser criada, para nenhum usuario",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: `  if (transaction_type !== "transfer") return {};
  return {`,
    para: `  return {`,
  },
  {
    nome: "regra decide o destino por truthy em vez de === 'transfer'",
    porque:
      "qualquer tipo nao vazio abriria o ramo que manda a coluna; um tipo desconhecido viraria transferencia disfarcada",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: `  if (transaction_type !== "transfer") return {};`,
    para: `  if (!transaction_type) return {};`,
  },
  {
    nome: "regra manda string vazia no lugar de NULL no destino",
    porque:
      "`''` numa coluna uuid volta 22P02, e a tela mostra 'nao foi possivel criar' sem dizer qual campo",
    alvo: TRANSFERENCIA,
    suite: "test:transferencia",
    de: `        ? destination_account_id
        : null,`,
    para: `        ? destination_account_id
        : "",`,
  },
];

let sobreviventes = 0;

const restaurar = () => {
  for (const [arquivo, conteudo] of Object.entries(originais)) {
    writeFileSync(arquivo, conteudo);
  }
};

try {
  for (const m of MUTACOES) {
    const original = originais[m.alvo];
    if (!original.includes(m.de)) {
      // Mutante que nao aplica e o pior resultado: conta como morto sem nunca
      // ter existido.
      console.log(`??  NAO APLICADA (trecho mudou): ${m.nome}`);
      sobreviventes++;
      continue;
    }

    writeFileSync(m.alvo, original.replace(m.de, m.para));

    let vermelho = false;
    try {
      execSync(`npm run ${m.suite}`, { stdio: "pipe" });
    } catch {
      vermelho = true;
    }

    restaurar();

    console.log(
      `${vermelho ? "OK  morreu    " : "XX  SOBREVIVEU"}  ${m.nome}  [${m.suite}]`
    );
    if (!vermelho) {
      console.log(`                  ${m.porque}`);
      sobreviventes++;
    }
  }
} finally {
  restaurar();
}

// Controle positivo: com os arquivos restaurados as duas suites tem de voltar ao
// verde. Sem ele, um erro que deixasse uma suite vermelha para SEMPRE mataria
// todas as mutacoes dela e o relatorio sairia perfeito.
let controleOk = true;
for (const suite of ["test:transferencia", "test:materializacao"]) {
  try {
    execSync(`npm run ${suite}`, { stdio: "pipe" });
    console.log(`\ncontrole positivo: ${suite} verde com os arquivos restaurados`);
  } catch {
    console.log(`\nXX CONTROLE POSITIVO FALHOU em ${suite} -- arquivo nao voltou`);
    controleOk = false;
  }
}

console.log(
  sobreviventes === 0
    ? `\n${MUTACOES.length} de ${MUTACOES.length} mutacoes mortas.`
    : `\n${sobreviventes} SOBREVIVENTE(S) de ${MUTACOES.length}.`
);
process.exit(sobreviventes === 0 && controleOk ? 0 : 1);
