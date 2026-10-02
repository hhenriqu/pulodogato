#!/usr/bin/env node
// Mutantes de lib/convite-de-grupo.ts -- HMO-197.
//
// POR QUE ISTO EXISTE
// -------------------
// `npm run test:convite-de-grupo` passa com 12 assercoes verdes. Isso, sozinho,
// nao diz nada: um teste que nunca reprova e indistinguivel de um teste que nao
// mede o que a justificativa dele afirma. Cada mutante abaixo desfaz UMA decisao
// do modulo; o teste tem que ficar vermelho em todos.
//
// OS MUTANTES QUE IMPORTAM sao `mensagem_unica` e `duplicata_so_pela_conta`. O
// primeiro e a propria HMO-196/197 do lado do texto: responder "convite enviado"
// para um convite que ainda nao foi entregue a ninguem foi o que produziu 5
// convites invisiveis em producao e deixou o admin esperando notificacao que nao
// existia. O segundo e o que grava convite duplicado para quem ainda nao tem
// conta -- as duas linhas sao reclamadas juntas no dia do cadastro.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// Mesma escolha do mutantes-chave-pix.mjs: a mutacao e feita em memoria e
// compilada a partir de um arquivo TEMPORARIO. `lib/convite-de-grupo.ts` nao e
// tocado em momento nenhum -- o jeito usual (mutar, rodar, restaurar no
// `finally`) deixa a fonte mutada no disco quando o processo morre no meio, e o
// placar seguinte vira ficcao. Medido nesta mesma issue: um runner que editava o
// arquivo foi interrompido por timeout e deixou a migration mutada.
//
// COMO RODAR
//   npm run mutantes:convite-de-grupo

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FONTE = "lib/convite-de-grupo.ts";
const SAIDA = ".tmp-convite-de-grupo";
const TESTE = "scripts/test-convite-de-grupo.mjs";

const original = readFileSync(FONTE, "utf8");

const MUTANTES = [
  {
    nome: "sem_trim",
    porque:
      "o email vai para o banco com espaco em volta; o btrim do trigger salva a " +
      "entrega, mas a lista do admin mostra ' a@b.c ' e a comparacao muda de chave",
    de: 'return String(valor ?? "").trim();',
    para: 'return String(valor ?? "");',
  },
  {
    nome: "grava_em_caixa_baixa",
    porque:
      "'normalizar tudo' -- o admin digita Leticia@Gmail.com e a lista do grupo " +
      "devolve leticia@gmail.com, como se o sistema tivesse corrigido o que ele escreveu",
    de: "return String(valor ?? \"\").trim();",
    para: "return String(valor ?? \"\").trim().toLowerCase();",
  },
  {
    nome: "comparacao_sensivel_a_caixa",
    porque:
      "'email ja vem normalizado do formulario' -- e a duplicata volta a passar " +
      "so por escrever Leticia@ na segunda vez",
    de: "return alvoParaGravar(valor).toLowerCase();",
    para: "return alvoParaGravar(valor);",
  },
  {
    nome: "duplicata_so_pela_conta",
    porque:
      "a perna do EMAIL sai -- convidar duas vezes quem ainda nao se cadastrou " +
      "grava duas linhas, e o trigger da 039 reclama as duas",
    de: `      (invitedUserId !== null && c.invited_user_id === invitedUserId) ||
      (c.invited_user_id === null &&
        alvoParaComparar(c.invite_target) === procurado)`,
    para: "      invitedUserId !== null && c.invited_user_id === invitedUserId",
  },
  {
    nome: "duplicata_so_pelo_email",
    porque:
      "a perna da CONTA sai -- dois cartoes iguais no sino de quem ja tem conta, " +
      "porque o texto digitado pode diferir do invite_target gravado",
    de: `      (invitedUserId !== null && c.invited_user_id === invitedUserId) ||
      (c.invited_user_id === null &&
        alvoParaComparar(c.invite_target) === procurado)`,
    para: `      c.invited_user_id === null &&
      alvoParaComparar(c.invite_target) === procurado`,
  },
  {
    nome: "duplicata_ignora_dono",
    porque:
      "'se o email bate, e duplicata' -- um convite JA entregue a outra pessoa " +
      "passa a bloquear o convite novo",
    de: `      (c.invited_user_id === null &&
        alvoParaComparar(c.invite_target) === procurado)`,
    para: "      alvoParaComparar(c.invite_target) === procurado",
  },
  {
    nome: "mensagem_unica",
    porque:
      "'a frase serve para os dois casos' -- E A HMO-197: responde 'convite " +
      "enviado' para um convite que ninguem pode ver ainda",
    de: "  if (invitedUserId === null) {",
    para: "  if (false) {",
  },
  {
    nome: "mensagem_sem_codigo",
    porque:
      "'o codigo do grupo nao tem nada a ver com o convite' -- tira a unica saida " +
      "rapida que o admin tem quando a pessoa ainda nao usa o app",
    de: "`14 dias. Para ser mais rápido, passe o código ${groupCode} para ela ` +\n      `entrar direto.`",
    para: "`14 dias.`",
  },
  {
    nome: "entrega_sempre_in_app",
    porque:
      "'delivery e sempre in_app, o canal e um so' -- o cliente perde o unico " +
      "sinal que distingue 'esta no app dela' de 'esta guardado'",
    de: 'return invitedUserId === null ? "on_signup" : "in_app";',
    para: 'return "in_app";',
  },
];

const dir = mkdtempSync(join(tmpdir(), "mut197-"));
let falhas = 0;

function compilaERoda(fonteTs) {
  const arquivo = join(dir, "convite-de-grupo.ts");
  writeFileSync(arquivo, fonteTs);
  execFileSync(
    "npx",
    ["tsc", arquivo, "--outDir", SAIDA, "--module", "es2020", "--target",
     "es2020", "--moduleResolution", "node", "--skipLibCheck"],
    { stdio: "pipe" }
  );
  execFileSync("node", ["--test", TESTE], { stdio: "pipe" });
}

try {
  // CONTROLE POSITIVO: com a fonte intacta o teste tem de PASSAR. Sem isto, um
  // "todos morreram" poderia significar apenas que o teste reprova sempre.
  try {
    compilaERoda(original);
    console.log("controle positivo: o teste passa com a fonte intacta\n");
  } catch (e) {
    console.error("ABORTADO: o teste reprova com a fonte INTACTA.");
    console.error((e.stdout ?? e.stderr ?? "").toString().slice(-800));
    process.exit(1);
  }

  for (const m of MUTANTES) {
    if (!original.includes(m.de)) {
      console.log(`  !! ${m.nome}: o trecho a mutar NAO EXISTE MAIS -- mutante invalido`);
      falhas++;
      continue;
    }
    const mutado = original.replace(m.de, m.para);

    let sobreviveu = false;
    try {
      compilaERoda(mutado);
      sobreviveu = true;
    } catch {
      // reprovou (ou nem compilou): e o esperado.
    }

    if (sobreviveu) {
      console.log(`  SOBREVIVEU  ${m.nome}  <-- nenhuma assercao protege isto`);
      console.log(`              (${m.porque})`);
      falhas++;
    } else {
      console.log(`  morreu      ${m.nome}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
  // Deixa o build em dia com a fonte de verdade, para o proximo `npm run
  // test:convite-de-grupo` nao rodar contra um artefato mutado.
  try {
    compilaERoda(original);
  } catch {
    /* o controle positivo acima ja teria falhado */
  }
}

console.log();
if (falhas === 0) {
  console.log(`todos os ${MUTANTES.length} mutantes morreram`);
} else {
  console.log(`${falhas} mutante(s) sobreviveu/sobreviveram ou sao invalidos`);
  process.exit(1);
}
