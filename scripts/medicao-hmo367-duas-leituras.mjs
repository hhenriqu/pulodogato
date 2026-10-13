#!/usr/bin/env node
// =====================================================
// MEDICAO HMO-367: as DUAS leituras do credito de grupo, antes e depois de UM
// acerto de verdade, em producao
// =====================================================
//   ANON_KEY=<a anon do projeto> \
//   EMAIL_A=... SENHA_A=... EMAIL_B=... SENHA_B=... \
//   ID_A=<uuid> ID_B=<uuid> ID_C=<uuid> GRUPO_ID=<uuid> \
//   node scripts/medicao-hmo367-duas-leituras.mjs
//
// ATENCAO, O SINAL DELA FOI VIRADO NA HMO-404
// -------------------------------------------
// Esta sonda nasceu afirmando o DEFEITO, e era verde por causa dele. Com o teto
// do acerto implementado (HMO-404), as tres assercoes do bloco [5] foram
// INVERTIDAS -- elas agora exigem que o credito CAIA, e os numeros antigos
// ficaram escritos ao lado de cada uma. Consequencia pratica: rodada contra
// producao ANTES do deploy do teto, a sonda reprova de proposito nessas tres
// linhas, e isso e o controle negativo dela. Todo o resto (L1, o controle da
// conta B, o desfazer) continua valendo nos dois lados.
//
// POR QUE ESTA MEDICAO EXISTE ANTES DE QUALQUER CONSERTO
// -----------------------------------------------------
// A HMO-367 nasceu da hipotese "o acerto nao abaixa o credito, entao subtraia o
// acerto de `fecharMes`". A medicao abaixo mostra que a hipotese esta certa no
// sintoma e ERRADA no conserto, e e por isso que ela e uma fase propria.
//
// As duas leituras respondem perguntas DIFERENTES, e cada uma com a sua fonte:
//
//   L1  "tela do grupo"   my-balance + [groupId]/transfers
//       -> view `group_member_balances` (007, cambio na 026):
//          pago - devido + acertos_pagos - acertos_recebidos
//          SEM recorte de mes, e SO REALIZADO.
//
//   L2  "aba Receitas"    my-credit + movimentacoes/resumo?tipo=income
//       -> `lerCreditoDosGrupos` -> `fecharMes`:
//          PREVISTO + REALIZADO juntos (pedido da HMO-245), recortado POR MES,
//          e sem tocar `group_settlements`.
//
// O QUE A SONDA MEDIU (prod, 12/10/2026, fixture HMO-255, grupo de 3 membros)
// --------------------------------------------------------------------------
// ESTADO DE PARTIDA -- `group_settlements` VAZIO, zero acerto registrado:
//
//            | L1 net (acumulado) | L1 transfers p/ mim | L2 credito do mes
//   conta A  |  -240,00           |  240,00             |   39,99
//   conta B  |   -60,00           |   60,00             |   10,00
//
// ** AS DUAS JA DISCORDAVAM SEM ACERTO NENHUM. ** 240 vs 39,99 e 60 vs 10 nao
// tem acerto no meio: e o recorte (acumulado vs mes) mais a mistura
// (realizado vs previsto+realizado). O acerto NAO e a causa da divergencia --
// ele acrescenta uma SEGUNDA divergencia em cima de uma que ja existia. Um
// conserto que so subtraia o acerto deixaria 240 vs 39,99 de pe.
//
// DEPOIS do acerto C -> A de R$ 240,00 (a sugestao que a propria tela faz,
// registrada por A, o lado que RECEBE):
//
//   L1 de A:  net -240 -> o grupo SAI de `resumo.grupos` (quitado),
//             transfers para mim 240 -> 0,  ou seja "nao ha nada a receber";
//   L2 de A:  my-credit 39,99 -> 39,99   (IDENTICO)
//             reembolso_previsto {"total":39.99,...} -> {"total":39.99,...}
//             em OUTUBRO (o mes do acerto) e em SETEMBRO.
//
// E o `acertos_do_grupo.confirmados` da HMO-366 foi de 0 -> 1 no mesmo corpo de
// resposta: a mesma dívida aparece como "recebida" num bloco e como "a receber"
// no «Previsto», na mesma tela, no mesmo JSON.
//
// POR QUE "SUBTRAIR O ACERTO DE `fecharMes`" NAO SERVE -- O NUMERO QUE PROVA
// -------------------------------------------------------------------------
// O acerto e de R$ 240,00 e o credito do mes e de R$ 39,99, porque os DOIS NAO
// SAO A MESMA GRANDEZA: o C deve 40/mes a A desde maio, e o acerto de 240
// quita SEIS MESES de uma vez (L1 de A: pago 540 = 90 x 6, devido 300 = 50 x 6).
//
//   39,99 - 240,00 = -200,01
//
// Subtrair dentro do mes devolve credito NEGATIVO, e nao ha como ratear o
// acerto pelos meses que ele paga: `group_settlements` tem UM `settled_on` e
// nao tem elo nenhum com a despesa nem com o mes que esta quitando. Prender o
// resultado em zero com um `Math.max` tambem nao serve -- zeraria outubro por
// um pagamento que cobre maio, que e o risco que a issue levantou ("subtrair um
// realizado de uma soma que inclui promessa pode zerar credito de conta que
// ainda nao foi paga").
//
// CONTROLE, E ELE NAO E VACUO
// ---------------------------
// A conta B e membro do MESMO grupo e nao e parte nenhuma deste acerto. Os
// quatro numeros dela ficaram identicos (-60 / 60 / 10,00 /
// {"total":10,...}) -- e sao todos diferentes de zero, entao "nao mexeu em B" e
// distinguivel de "a leitura morreu". O mes de setembro entra como segundo
// controle, pelo mesmo motivo.
//
// A SONDA ESCREVE EM PRODUCAO, E DESFAZ
// ------------------------------------
// Ela exige `group_settlements` VAZIO para comecar (senao a medicao DEPOIS nao
// tem com o que comparar), grava um acerto de verdade pela rota do app, mede, e
// apaga no fim conferindo campo por campo que a fixture voltou ao estado
// anterior. Rode so na fixture de teste.
// =====================================================

const APP = (process.env.APP_URL || "https://pulodogato.hmoraes.com.br").replace(/\/$/, "");
const SUPA = (
  process.env.SUPABASE_URL || "https://odxqjvtxsioksguuevqm.supabase.co"
).replace(/\/$/, "");
const ANON = process.env.ANON_KEY;
const GRUPO = process.env.GRUPO_ID;
const VALOR = Number(process.env.VALOR || 240);

const CONTAS = {
  A: [process.env.EMAIL_A, process.env.SENHA_A],
  B: [process.env.EMAIL_B, process.env.SENHA_B],
};
const ID = { A: process.env.ID_A, B: process.env.ID_B, C: process.env.ID_C };

if (!ANON || !GRUPO || Object.values(CONTAS).some((c) => !c[0] || !c[1]) || Object.values(ID).some((v) => !v)) {
  console.error(
    "Faltou ANON_KEY / GRUPO_ID / EMAIL_A,SENHA_A / EMAIL_B,SENHA_B / ID_A,ID_B,ID_C.\n" +
      "Sem as DUAS sessoes esta sonda nao tem controle: a conta que nao e parte do\n" +
      "acerto e o que distingue 'o acerto nao mexeu nela' de 'a leitura morreu'."
  );
  process.exit(2);
}

const ref = new URL(SUPA).hostname.split(".")[0];

async function sessaoDe(email, senha) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: senha }),
  });
  const s = await r.json();
  // A anon key errada responde `Invalid API key` com um hint que manda procurar
  // permissao -- confira que o valor comeca com `eyJ` antes de culpar a conta.
  if (!s.access_token) throw new Error(`login ${email}: ${JSON.stringify(s)}`);
  const valor = "base64-" + Buffer.from(JSON.stringify(s)).toString("base64");
  if (valor.length > 3180) throw new Error(`o cookie de ${email} tem ${valor.length} chars: quebre em .0/.1`);
  return { cookie: `sb-${ref}-auth-token=${valor}` };
}

async function chamar(s, caminho, metodo = "GET", corpo) {
  const r = await fetch(`${APP}${caminho}`, {
    method: metodo,
    headers: { Cookie: s.cookie, ...(corpo ? { "Content-Type": "application/json" } : {}) },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const t = await r.text();
  try {
    return { status: r.status, corpo: JSON.parse(t) };
  } catch {
    // Rota que nao existe devolve o HTML do 404, que estoura no JSON.parse como
    // `Unexpected token '<'` -- devolver o texto cru diz qual rota errou.
    return { status: r.status, corpo: t.slice(0, 300) };
  }
}

const sess = {};
for (const [k, [e, p]] of Object.entries(CONTAS)) sess[k] = await sessaoDe(e, p);

/**
 * As QUATRO leituras de uma conta num mes: duas de L1, duas de L2.
 *
 * As quatro juntas, e nao so o total de uma: `my-balance` sozinho nao
 * distingue "o acerto entrou na view" de "o grupo saiu da lista por estar
 * quitado", e e exatamente o que acontece depois do POST (net -240 -> null).
 */
async function lerAsQuatro(quem, de, ate) {
  const s = sess[quem];

  const mb = await chamar(s, "/api/expense-groups/my-balance");
  const g = (mb.corpo?.resumo?.grupos ?? []).find((x) => x.group_id === GRUPO);

  const tf = await chamar(s, `/api/expense-groups/${GRUPO}/transfers`);
  const paraMim = (tf.corpo?.transfers ?? [])
    .filter((t) => t.to?.id === ID[quem])
    .reduce((a, t) => a + Number(t.amount), 0);

  const mc = await chamar(s, `/api/expense-groups/my-credit?de=${de}&ate=${ate}`);
  const rs = await chamar(s, `/api/movimentacoes/resumo?tipo=income&de=${de}&ate=${ate}`);

  return {
    // L1 -- group_member_balances: acumulado, so realizado, JA neta acertos
    L1_net: g ? Number(g.devo) : null,
    L1_paid: g ? Number(g.total_paid) : null,
    L1_owed: g ? Number(g.total_owed) : null,
    L1_transfers_para_mim: paraMim,
    // L2 -- fecharMes: por mes, previsto + realizado, IGNORA acertos
    L2_my_credit_total: mc.corpo?.credito?.total ?? null,
    L2_my_credit_linhas: (mc.corpo?.credito?.linhas ?? []).map((l) => `${l.devedor}:${l.valor}`),
    L2_previsto: rs.corpo?.resumo?.previsto ?? null,
    L2_realizado: rs.corpo?.resumo?.realizado ?? null,
    L2_reembolso_previsto: rs.corpo?.resumo?.reembolso_previsto ?? null,
    // HMO-366: o bloco "Acerto de grupo recebido", FORA do total
    L2_acertos_do_grupo: rs.corpo?.acertos_do_grupo
      ? {
          a_confirmar: (rs.corpo.acertos_do_grupo.a_confirmar ?? []).length,
          confirmados: (rs.corpo.acertos_do_grupo.confirmados ?? []).length,
        }
      : null,
  };
}

const MESES = [
  ["out/2026 -- o mes do acerto", "2026-10-01", "2026-10-31"],
  ["set/2026 -- CONTROLE de mes", "2026-09-01", "2026-09-30"],
];

async function retrato() {
  const r = {};
  for (const quem of ["A", "B"]) {
    for (const [rotulo, de, ate] of MESES) r[`${quem} | ${rotulo}`] = await lerAsQuatro(quem, de, ate);
  }
  return r;
}

const falhas = [];
const medir = (rotulo, ok, det = "") => {
  console.log(`  ${ok ? "ok   " : "FALHA"} | ${rotulo}${det ? "  -- " + det : ""}`);
  if (!ok) falhas.push(rotulo);
};

// ---------------------------------------------------------------------------
// 0. Estado de partida: o livro de acertos tem de estar VAZIO
// ---------------------------------------------------------------------------
const acertos0 = await chamar(sess.A, `/api/expense-groups/${GRUPO}/settlements`);
const lista0 = acertos0.corpo?.settlements ?? [];
medir("o grupo comeca SEM acerto nenhum", lista0.length === 0, `${lista0.length} acerto(s)`);
if (lista0.length !== 0) {
  console.error("\nPartida suja: a medicao DEPOIS nao teria com o que comparar. Apague os acertos antes.");
  process.exit(1);
}

// `account_id` e OBRIGATORIO no POST desde a HMO-245 fase 11 -- a rota grava a
// perna de quem registra em `financial_transactions`.
const contas = await chamar(sess.A, "/api/financial-accounts");
const listaContas = contas.corpo?.accounts ?? contas.corpo ?? [];
const contaDeA = listaContas.find((c) => Number(c.current_balance) > VALOR) ?? listaContas[0];
medir("A tem conta para receber o Pix", Boolean(contaDeA?.id), `${contaDeA?.name} (${contaDeA?.id})`);
if (!contaDeA?.id) process.exit(1);

// ---------------------------------------------------------------------------
// 1 e 2. ANTES, e o acerto
// ---------------------------------------------------------------------------
const antes = await retrato();
console.log("\n[1] ANTES do acerto\n" + JSON.stringify(antes, null, 1));

const post = await chamar(sess.A, `/api/expense-groups/${GRUPO}/settlements`, "POST", {
  from_user_id: ID.C,
  to_user_id: ID.A,
  amount: VALOR,
  account_id: contaDeA.id,
  note: "HMO-367 medicao das duas leituras",
});
console.log(`\n[2] POST settlements -> ${post.status}\n    ${JSON.stringify(post.corpo).slice(0, 700)}`);
medir("o acerto foi registrado", post.status === 200 || post.status === 201);

const idDoAcerto = post.corpo?.settlement?.id ?? null;
medir("a resposta traz o id do acerto (para o DELETE)", Boolean(idDoAcerto), String(idDoAcerto));
if (!idDoAcerto) {
  console.error("\nSem id nao da para desfazer. Apague a mao antes de rodar de novo.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3 e 4. DEPOIS, e o diff campo por campo
// ---------------------------------------------------------------------------
const depois = await retrato();
console.log("\n[3] DEPOIS do acerto\n" + JSON.stringify(depois, null, 1));

console.log("\n[4] O QUE MUDOU");
for (const chave of Object.keys(antes)) {
  const [a, d] = [antes[chave], depois[chave]];
  const difs = Object.keys(a).filter((c) => JSON.stringify(a[c]) !== JSON.stringify(d[c]));
  console.log(`\n  ${chave}: ${difs.length ? difs.length + " campo(s)" : "NADA MUDOU"}`);
  for (const c of difs) console.log(`    ${c}: ${JSON.stringify(a[c])}  ->  ${JSON.stringify(d[c])}`);
}

// ---------------------------------------------------------------------------
// 5. As assercoes
// ---------------------------------------------------------------------------
console.log("\n[5] ASSERCOES");
const aOut = "A | out/2026 -- o mes do acerto";
const bOut = "B | out/2026 -- o mes do acerto";

// A DIVERGENCIA DE PARTIDA, que e o achado desta fase: ela nao precisa de
// acerto nenhum para existir, e por isso vem medida ANTES do POST.
medir(
  "as duas leituras JA discordavam sem acerto nenhum (A)",
  Number(antes[aOut].L1_transfers_para_mim) !== Number(antes[aOut].L2_my_credit_total),
  `L1 ${antes[aOut].L1_transfers_para_mim} vs L2 ${antes[aOut].L2_my_credit_total}`
);
medir(
  "as duas leituras JA discordavam sem acerto nenhum (B)",
  Number(antes[bOut].L1_transfers_para_mim) !== Number(antes[bOut].L2_my_credit_total),
  `L1 ${antes[bOut].L1_transfers_para_mim} vs L2 ${antes[bOut].L2_my_credit_total}`
);

medir(
  "L1 VIU o acerto: o acumulado de A mudou",
  JSON.stringify(antes[aOut].L1_net) !== JSON.stringify(depois[aOut].L1_net),
  `${antes[aOut].L1_net} -> ${depois[aOut].L1_net} (null = grupo quitado saiu da lista)`
);
medir(
  "L1 tirou a sugestao C->A da lista de transferencias",
  Number(depois[aOut].L1_transfers_para_mim) === 0,
  `${antes[aOut].L1_transfers_para_mim} -> ${depois[aOut].L1_transfers_para_mim}`
);

// ---------------------------------------------------------------------------
// O SINAL DESTAS TRES ASSERCOES FOI VIRADO NA HMO-404 -- E ELAS SAO O ORACULO
// ---------------------------------------------------------------------------
// Ate a HMO-404 elas afirmavam o DEFEITO, e eram verdes porque o defeito
// existia. Os numeros que elas mediam, em producao, contra o codigo de antes
// (prod, 12/10/2026 e de novo em 13/10/2026 -- as duas rodadas identicas):
//
//   L2 my-credit de A, out/2026:  39,99  ->  39,99   (NAO mudou)
//   L2 my-credit de A, set/2026:  39,99  ->  39,99   (NAO mudou)
//   reembolso_previsto de A:      {"total":39.99,...} -> IDENTICO
//   confirmados 1 E credito 39,99 no MESMO corpo de resposta
//
// Apagar a sonda perderia o oraculo; deixar o sinal antigo deixaria a sonda
// verde sobre o conserto que ela existe para medir. Entao ela ficou, com o
// sinal invertido: o que era "nao mudou" agora exige MUDOU, e e o mesmo
// arquivo que mede o antes e o depois. O teto do acerto previsto para o caso
// medido e `max(0, 240 - 240) = 0`, ou seja os 39,99 vao a 0,00.
console.log("\n  -- O CONSERTO DA HMO-404: O ACERTO VIRA TETO --");
for (const [rotulo, chave] of [["out/2026 (o mes do acerto)", aOut], ["set/2026", "A | set/2026 -- CONTROLE de mes"]]) {
  medir(
    `CONSERTO: L2 my-credit de A CAIU em ${rotulo} (antes: 39,99 -> 39,99)`,
    Number(depois[chave].L2_my_credit_total) < Number(antes[chave].L2_my_credit_total),
    `${antes[chave].L2_my_credit_total} -> ${depois[chave].L2_my_credit_total}`
  );
}
// O numero exato, e nao so a direcao: o acerto de 240 cobre o acumulado de 240,
// entao o teto e ZERO e o credito do mes vai a zero (ou a linha sai da lista, e
// `my-credit` responde total 0). Uma assercao so de direcao passaria verde com
// o teto subtraindo o acerto DENTRO do mes, que e a alternativa 1, reprovada.
medir(
  "CONSERTO: o credito de A vai a ZERO em out/2026 (teto = max(0, 240 - 240))",
  Number(depois[aOut].L2_my_credit_total) === 0,
  `${antes[aOut].L2_my_credit_total} -> ${depois[aOut].L2_my_credit_total}`
);
medir(
  "CONSERTO: o reembolso_previsto do «Previsto» de A mudou (antes: identico)",
  JSON.stringify(antes[aOut].L2_reembolso_previsto) !== JSON.stringify(depois[aOut].L2_reembolso_previsto),
  `${JSON.stringify(antes[aOut].L2_reembolso_previsto)} -> ${JSON.stringify(depois[aOut].L2_reembolso_previsto)}`
);
medir(
  "CONSERTO: a mesma divida NAO aparece mais como recebida e como a receber no mesmo corpo",
  Number(depois[aOut].L2_acertos_do_grupo?.confirmados) > 0 &&
    Number(depois[aOut].L2_my_credit_total) === 0,
  `confirmados ${depois[aOut].L2_acertos_do_grupo?.confirmados} e credito ${depois[aOut].L2_my_credit_total}`
);
medir(
  "o acerto e de outra GRANDEZA que o credito do mes (subtrair daria negativo)",
  VALOR > Number(antes[aOut].L2_my_credit_total),
  `acerto ${VALOR} vs credito do mes ${antes[aOut].L2_my_credit_total} -> ${(Number(antes[aOut].L2_my_credit_total) - VALOR).toFixed(2)}`
);

console.log("\n  -- CONTROLE: B e do mesmo grupo e nao e parte do acerto --");
for (const campo of ["L1_net", "L1_transfers_para_mim", "L2_my_credit_total", "L2_reembolso_previsto"]) {
  medir(
    `controle B: ${campo} identico`,
    JSON.stringify(antes[bOut][campo]) === JSON.stringify(depois[bOut][campo]),
    `${JSON.stringify(antes[bOut][campo])} -> ${JSON.stringify(depois[bOut][campo])}`
  );
}
medir(
  "o controle de B nao e vacuo: os numeros dele sao diferentes de zero",
  Number(antes[bOut].L1_net) !== 0 && Number(antes[bOut].L2_my_credit_total) !== 0,
  `L1 ${antes[bOut].L1_net} / L2 ${antes[bOut].L2_my_credit_total}`
);

// ---------------------------------------------------------------------------
// 6. Desfazer, e provar que desfez
// ---------------------------------------------------------------------------
const del = await chamar(sess.A, `/api/expense-groups/${GRUPO}/settlements/${idDoAcerto}`, "DELETE");
console.log(`\n[6] DELETE -> ${del.status} ${JSON.stringify(del.corpo).slice(0, 300)}`);

const volta = await retrato();
const voltou = Object.keys(antes).every((k) => JSON.stringify(antes[k]) === JSON.stringify(volta[k]));
medir("a fixture voltou EXATAMENTE ao estado de antes", voltou);
for (const k of Object.keys(antes)) {
  if (JSON.stringify(antes[k]) !== JSON.stringify(volta[k])) {
    console.log(`    ${k}:\n      antes ${JSON.stringify(antes[k])}\n      agora ${JSON.stringify(volta[k])}`);
  }
}

const acertosFim = await chamar(sess.A, `/api/expense-groups/${GRUPO}/settlements`);
medir("o livro de acertos ficou vazio de novo", (acertosFim.corpo?.settlements ?? []).length === 0);

console.log(`\n${falhas.length ? falhas.length + " FALHA(S): " + falhas.join("; ") : "todas as medidas bateram"}`);
process.exit(falhas.length ? 1 : 0);
