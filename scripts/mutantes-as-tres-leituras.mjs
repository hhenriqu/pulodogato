#!/usr/bin/env node
// =====================================================
// OS MUTANTES DA CONVENCAO `my_status` (HMO-416)
// =====================================================
// Roda com:  npm run mutantes:as-tres-leituras
//
// O QUE ESTE RUNNER MEDE
// ----------------------
// `scripts/check-as-oito-leituras.mjs` e um guard de CONVENCAO: ele afirma que
// as nove leituras de dinheiro de `scheduled_transactions_effective` usam o
// estado da PESSOA (`my_status`) e que as quatro excecoes declaradas seguem no
// estado da CONTA (`status`). Ele sai verde na arvore certa -- e verde na
// arvore certa nao prova nada: um guard cujo criterio parou de casar imprime
// exatamente o mesmo `✔`.
//
// Este runner planta cada defeito NO FONTE DAS ROTAS e exige que o guard fique
// VERMELHO. Mutante que sobrevive e afirmacao que o guard faz sem medir.
//
// POR QUE ELE MUTA AS ROTAS, E NAO O GUARD
// -----------------------------------------
// Os runners de guard deste repositorio (`mutantes-guarda-do-sed-dos-workflows`
// e companhia) mutam o FONTE DA GUARDA e rodam a suite dela. Aqui a direcao e a
// oposta, e de proposito: este guard nao tem suite propria, e o que ele promete
// nao e "sei reprovar entrada invalida" -- e "a arvore nao pode chegar neste
// estado". O defeito que importa e o defeito no app, entao e ele que se planta.
//
// O ESTADO QUE ESTE GUARD IMPEDE JA ACONTECEU, E ESSE E O PONTO
// --------------------------------------------------------------
// A HMO-411 trocou oito leituras e deixou quatro para tras. Nao por descuido:
// as quatro eram inertes, e provar isso uma a uma custou a HMO-416 inteira. O
// guard existe para que a decima leitura nao repita a conta, e este runner
// existe para que o guard nao esteja medindo o conjunto vazio quando ela
// chegar.
//
// AS DUAS METADES DA CONFERENCIA DE EXCECAO TEM MUTANTE SEPARADO
// ---------------------------------------------------------------
// O guard confere cada excecao duas vezes (a coluna do dono continua no lugar
// declarado; a coluna da pessoa nao entrou). Um mutante que faz as duas coisas
// de uma vez -- trocar `status` por `my_status` -- morreria com qualquer uma
// das metades viva, e absolveria a outra. Por isso ha tambem
// `fechamento_ganha_my_status_sem_perder_status` (so a metade 2 pega) e
// `fechamento_status_sai_do_select_e_vira_filtro` (so a metade 1, e so porque
// ela olha o LUGAR).
//
// TUDO NUMA SOMBRA EM /tmp, SEM `trap`
// ------------------------------------
// O repositorio (menos `.git`, `node_modules`, `.next` e os `.tmp-*`) e copiado
// uma vez para um `mkdtempSync`, e a mutacao acontece la. Nao ha nada para
// restaurar: morrer no meio -- SIGTERM, SIGKILL, timeout do runner -- nao deixa
// mutante gravado em `app/`. E a regra que `check-mutacao-no-lugar.mjs` cobra
// de todo runner novo.
//
// O CONTROLE POSITIVO E O PRIMEIRO, E NAO E CERIMONIA
// ---------------------------------------------------
// A sombra NAO MUTADA tem de rodar o guard e sair 0. Se ela sair vermelha --
// por um caminho que a copia quebrou, por qualquer coisa -- entao TODO mutante
// "morre", o placar sai 10/10 perfeito e nao mediu nada. Suite vermelha faz
// todo controle negativo passar vacuo, e um placar perfeito e o disfarce mais
// confortavel desse estado.
// =====================================================

import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const GUARDA = "scripts/check-as-oito-leituras.mjs";

// OS ALVOS SAO CONSTANTES NOMEADAS, E ISSO E EXIGENCIA DE FORMA, NAO ESTILO.
// `mede-ancora-ambigua.mjs` le a lista abaixo IMPORTANDO um recorte do fonte, e
// precisa saber onde o recorte comeca. Com os caminhos escritos como literal
// dentro de cada mutante nao ha nenhuma declaracao para ancorar o inicio, e a
// guarda ABORTA nomeando este arquivo -- e um runner que a guarda de ancora nao
// consegue ler e um runner cujas ancoras ninguem confere
// (`runner-fora-da-forma-canonica-derruba-a-guarda-de-ancora`).
const CARD_INVOICES = "app/api/card-invoices/route.ts";
const FECHAMENTO = "app/api/expense-groups/[groupId]/fechamento/route.ts";
const SEMEAR_DIVISAO = "app/api/expense-groups/[groupId]/semear-divisao/route.ts";
const TELA_DO_GRUPO = "app/api/expense-groups/[groupId]/scheduled/route.ts";
const CREDITO_DOS_GRUPOS = "lib/services/credito-dos-grupos.ts";

/**
 * Um mutante por afirmacao do guard. `de` tem de casar EXATAMENTE uma vez no
 * arquivo que o mutante muta -- e o `arquivo` de cada um e o alvo, porque este
 * runner muta CINCO arquivos diferentes e nao um so.
 */
const MUTANTES = [
  // ---------------------------------------------------------------------
  // A NONA LEITURA (a que a HMO-416 trocou). Os dois mutantes abaixo sao as
  // duas maneiras de ela voltar a estar errada, e o guard distingue: a
  // primeira e a convencao quebrada, a segunda e dinheiro.
  // ---------------------------------------------------------------------
  {
    nome: "card_invoices_volta_para_status",
    arquivo: CARD_INVOICES,
    porque:
      "A REVERSAO. Este e o unico mutante do runner que NAO muda numero nenhum " +
      "em producao -- a rota filtra `user_id` na mao e a 055 garante " +
      "`my_status = status::text` para linha minha. E exatamente por ser inerte " +
      "que nenhuma suite de comportamento pode mata-lo: o guard e o unico " +
      "aparelho que sobra, e se ele nao pegar isto, a convencao nao existe",
    de: `        .eq("my_status", "pending")`,
    para: `        .eq("status", "pending")`,
  },
  {
    nome: "card_invoices_perde_o_filtro_de_estado",
    arquivo: CARD_INVOICES,
    porque:
      "o controle POSITIVO do guard, e ele nao e cerimonia: uma leitura que " +
      "deixa de filtrar por estado nao e inocua. A previsao do cartao ja paga " +
      "voltaria para a tela da fatura, listada como pendente. Sem esta metade " +
      "do guard, apagar o filtro passaria verde -- nao ha `status` proibido numa " +
      "cadeia que nao filtra nada",
    de: `        .eq("my_status", "pending")\n`,
    para: "",
  },

  // ---------------------------------------------------------------------
  // AS EXCECOES, CONFERIDAS AO CONTRARIO. O defeito aqui e alguem "arrumando"
  // uma excecao para a coluna nova -- e e um defeito de dinheiro: a conta que
  // ja recebeu baixa volta a contar como prevista, em cima da transacao real
  // que a baixa criou.
  // ---------------------------------------------------------------------
  {
    nome: "fechamento_select_vira_my_status",
    arquivo: FECHAMENTO,
    porque:
      "a arrumacao ingenua, e ela custa dinheiro duas vezes: `linhaDoPrevisto` " +
      "le `linha.status`, que passaria a chegar `undefined` e nunca a ser " +
      "'paid'. TODA conta paga do grupo entraria no previsto somada a propria " +
      "transacao real -- a internet de R$ 159,90 vira R$ 319,80",
    de: `      .select("id, description, amount, due_date, user_id, status, direction")`,
    para: `      .select("id, description, amount, due_date, user_id, my_status, direction")`,
  },
  {
    nome: "fechamento_ganha_my_status_sem_perder_status",
    arquivo: FECHAMENTO,
    porque:
      "O MUTANTE QUE SEPARA AS DUAS METADES. Acrescentar a coluna da pessoa sem " +
      "tirar a do dono e o passo intermediario de uma migracao interrompida: " +
      "`linhaDoPrevisto` ainda funciona HOJE, e para de funcionar no dia em que " +
      "alguem trocar o campo que ele le. A metade 1 do guard (a coluna do dono " +
      "continua no `select`) absolve isto; so a metade 2 pega",
    de: `      .select("id, description, amount, due_date, user_id, status, direction")`,
    para: `      .select("id, description, amount, due_date, user_id, status, my_status, direction")`,
  },
  {
    nome: "fechamento_status_sai_do_select_e_vira_filtro",
    arquivo: FECHAMENTO,
    porque:
      "O OUTRO MUTANTE DE SEPARACAO, e ele mede o `onde`. A cadeia continua " +
      "CITANDO `status` -- um guard de 'a coluna aparece em algum lugar' sairia " +
      "verde --, mas ela saiu do `select`, entao `linhaDoPrevisto` le " +
      "`undefined` e nao descarta mais nada. E o filtro novo nem compensa: ele " +
      "deixa de fora a conta `overdue`, que tambem e prevista",
    de: `      .select("id, description, amount, due_date, user_id, status, direction")
      .eq("group_id", groupId);`,
    para: `      .select("id, description, amount, due_date, user_id, direction")
      .eq("group_id", groupId)
      .eq("status", "pending");`,
  },
  {
    nome: "semear_divisao_select_vira_my_status",
    arquivo: SEMEAR_DIVISAO,
    porque:
      "a pior das quatro excecoes se cair, porque esta rota le pelo cliente de " +
      "SERVICE ROLE: sem sessao `auth.uid()` e NULL e `my_status` desaba para a " +
      "constante 'pending' em TODA linha. A divisao por renda sairia semeada " +
      "com o dobro da renda de quem mais recebeu, sem erro nenhum na tela",
    de: `      .select("id, description, amount, due_date, user_id, status, direction")`,
    para: `      .select("id, description, amount, due_date, user_id, my_status, direction")`,
  },
  {
    nome: "credito_dos_grupos_select_vira_my_status",
    arquivo: CREDITO_DOS_GRUPOS,
    porque:
      "a QUARTA leitora, a que a issue da HMO-416 nao tinha visto -- ela estava " +
      "fora das duas listas, como as outras tres. Dobra o credito de todo grupo " +
      "em duas telas de uma vez (as abas de movimentacao e o «meu credito»), " +
      "porque as duas chamam este mesmo servico",
    de: `      "id, description, amount, due_date, user_id, status, direction, group_id"`,
    para: `      "id, description, amount, due_date, user_id, my_status, direction, group_id"`,
  },

  // ---------------------------------------------------------------------
  // A EXCECAO QUE JA EXISTIA (HMO-411). Ela e a unica que guarda `status` num
  // FILTRO, e os dois mutantes abaixo cobram as duas coisas que o guard diz
  // sobre ela: que o filtro existe, e que ele tem a forma declarada.
  // ---------------------------------------------------------------------
  {
    nome: "tela_do_grupo_neq_vira_my_status",
    arquivo: TELA_DO_GRUPO,
    porque:
      "a excecao original da HMO-411, revertida: o GRUPO nao tem status de " +
      "pago. Com `my_status` a conta prevista reaparece na aba de previstas " +
      "depois da baixa, e o aluguel fica nas DUAS abas -- previstas e despesas",
    de: `      .neq("status", "paid")`,
    para: `      .neq("my_status", "paid")`,
  },
  {
    nome: "tela_do_grupo_neq_vira_eq",
    arquivo: TELA_DO_GRUPO,
    porque:
      "O MUTANTE QUE MEDE O `forma`. A cadeia continua filtrando `status` -- a " +
      "metade 1 do guard absolve, e a metade 2 tambem, porque `my_status` nao " +
      "aparece. Mas a tela inverte: ela passa a listar SO a conta ja paga, e as " +
      "previstas de verdade somem. Sem o `forma`, isto e um estado que o guard " +
      "chama de correto",
    de: `      .neq("status", "paid")`,
    para: `      .eq("status", "paid")`,
  },
  {
    nome: "tela_do_grupo_perde_o_filtro",
    arquivo: TELA_DO_GRUPO,
    porque:
      "a excecao apagada em vez de trocada -- o jeito mais barato de uma " +
      "refatoracao destruir a decisao. A aba de previstas passa a listar " +
      "tambem o que ja foi pago, e as linhas aparecem duplicadas com a aba de " +
      "despesas",
    de: `      .neq("status", "paid")\n`,
    para: "",
  },
];

// -----------------------------------------------------------------------------

const sombra = mkdtempSync(join(tmpdir(), "hmo416-mutantes-"));
process.on("exit", () => {
  try {
    rmSync(sombra, { recursive: true, force: true });
  } catch {}
});

console.log(`sombra: ${sombra}`);
cpSync(RAIZ, sombra, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(RAIZ.length);
    return (
      !/(^|\/)(\.git|node_modules|\.next)(\/|$)/.test(rel) && !/(^|\/)\.tmp-/.test(rel)
    );
  },
});

/** O fonte intacto de cada arquivo que algum mutante toca. */
const ORIGINAIS = new Map(
  [...new Set(MUTANTES.map((m) => m.arquivo))].map((a) => [
    a,
    readFileSync(join(sombra, a), "utf8"),
  ])
);

/** Roda o guard na sombra. Devolve o codigo de saida e a saida inteira. */
function rodarGuarda() {
  const r = spawnSync("node", [GUARDA], { cwd: sombra, encoding: "utf8" });
  return { status: r.status, saida: (r.stdout || "") + (r.stderr || "") };
}

// O CONTROLE POSITIVO, PRIMEIRO.
const positivo = rodarGuarda();
if (positivo.status !== 0) {
  console.error(
    "::error::A sombra NAO MUTADA reprova o guard. Todo mutante 'morreria' e o placar seria vacuo."
  );
  console.error(positivo.saida.split("\n").slice(-25).join("\n"));
  process.exit(1);
}
console.log("controle positivo: a sombra intacta passa o guard (exit 0)\n");

let mortos = 0;
const vivos = [];

for (const m of MUTANTES) {
  const original = ORIGINAIS.get(m.arquivo);

  // A ANCORA, ANTES DE MUTAR. Exatamente uma ocorrencia: zero e ancora morta,
  // mais de uma e ambigua e `replace` trocaria so a primeira -- mutando um
  // lugar que o nome do mutante nao descreve.
  const n = original.split(m.de).length - 1;
  if (n !== 1) {
    console.error(
      `::error::ancora do mutante \`${m.nome}\` aparece ${n} vez(es) em ${m.arquivo} -- ` +
        `${n === 0 ? "ANCORA MORTA" : "ANCORA AMBIGUA"}. Conserte o \`de\` deste mutante; ` +
        "sem isso ele mediria a arvore INTACTA."
    );
    process.exit(1);
  }

  writeFileSync(join(sombra, m.arquivo), original.replace(m.de, m.para));
  const r = rodarGuarda();
  writeFileSync(join(sombra, m.arquivo), original);

  if (r.status !== 0) {
    mortos++;
    const acusacoes = (r.saida.match(/^✖ .*$/gm) || []).map((l) => l.replace(/^✖ /, ""));
    console.log(`  MORTO     ${m.nome}`);
    console.log(
      `            ${acusacoes.length ? acusacoes.slice(0, 2).join(" | ") : "(reprovou sem acusar arquivo)"}`
    );
  } else {
    vivos.push(m);
    console.log(`  VIVO      ${m.nome}`);
  }
}

console.log(`\nplacar: ${mortos}/${MUTANTES.length} mortos`);

if (vivos.length) {
  console.error(
    `\n::error::${vivos.length} mutante(s) SOBREVIVERAM -- o guard afirma algo que nao mede:`
  );
  for (const m of vivos) {
    console.error(`\n  * ${m.nome}  (${m.arquivo})`);
    console.error(`    ${m.porque}`);
  }
  process.exit(1);
}

console.log(
  "todos mortos: cada afirmacao de check-as-oito-leituras.mjs tem controle negativo."
);
