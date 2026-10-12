#!/usr/bin/env node
// =====================================================
// MEDICAO EM PRODUCAO -- o GESTO de antecipar na tela (HMO-397, F4 da HMO-393)
// =====================================================
//   node scripts/medicao-gesto-de-antecipar-em-prod.mjs
//
// NAO E SUITE: nao roda no CI, nao tem assercao de `node:test`. Os SETE PASSOS
// de DADO da antecipacao ja estao medidos pela F2/F3 em
// `scripts/medicao-antecipacao-do-mybank.mjs`, e repeti-los aqui seria medir de
// novo o que nao mudou. O que a F4 acrescenta e VISUAL, e e isso que este script
// mede, em duas metades que respondem perguntas diferentes:
//
//   METADE 1 -- O GESTO ESTA NO BUNDLE PUBLICADO. `deploy-ships-code-not-schema`:
//     merge nao e deploy, e a tela so tem o gesto depois de a Vercel publicar.
//     A medida e o CHUNK servido por producao contendo as ancoras do gesto.
//
//   METADE 2 -- EM QUAIS LINHAS ELE APARECE. O chunk prova que o codigo esta lá;
//     ele nao diz nada sobre quais emprestimos satisfazem `podeAntecipar`. Essa
//     e uma pergunta de DADO, e a resposta sai da MESMA rota que a tela le
//     (`GET /api/mybank/loans`), com a sessao da conta de teste.
//
// POR QUE NAO UMA SONDA DE NAVEGADOR CONTRA PRODUCAO
// --------------------------------------------------
// Ela mediria a mesma coisa com mais partes moveis. O que pode estar errado aqui
// e (a) o codigo nao ter subido e (b) o dado nao satisfazer a condicao -- e as
// duas se medem sem render. O RENDER esta medido em CI, em Chromium, por
// `npm run test:mybank-na-tela` (casos K1..K10), que e onde a assercao sobre o
// DOM pertence.
//
// AS ANCORAS SAO TODAS ASCII, E ISSO E OBRIGATORIO
// -----------------------------------------------
// `grep-de-acento-em-chunk-minificado-da-0`: o chunk escapa acento (`ã`),
// entao procurar "antecipação" devolve ZERO numa tela que esta perfeita -- e o
// relatorio diria "nao publicado" sobre um deploy que subiu. Toda ancora abaixo
// e ASCII puro.
//
// E NENHUMA DELAS AFIRMA ORDEM OU POSICAO: `offset-em-chunk-minificado-nao-
// prova-ordem`. O que se mede e presenca, uma por uma, com o nome de cada uma no
// relatorio -- uma contagem agregada diria "4 de 5" sem dizer qual faltou.
//
// CREDENCIAIS: as duas contas de teste que ja existem em producao (memorias
// `conta-de-teste-em-prod` e `par-de-contas-a-e-b-conectadas-em-prod`). A anon
// key sai do `.env.local`, que nao esta no git.
// =====================================================

import { readFileSync } from "node:fs";

const APP = "https://pulodogato.hmoraes.com.br";

const ENV = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const le = (chave) => {
  const achado = ENV.match(new RegExp(`^${chave}=(.*)$`, "m"));
  return achado ? achado[1].trim() : null;
};

const SUPABASE = le("NEXT_PUBLIC_SUPABASE_URL");
const ANON = le("NEXT_PUBLIC_SUPABASE_ANON_KEY");

if (!ANON || !ANON.startsWith("eyJ")) {
  throw new Error(`anon key invalida no .env.local: ${String(ANON).slice(0, 24)}`);
}

const REF = new URL(SUPABASE).hostname.split(".")[0];

const CONTA_A = {
  nome: "A (credora)",
  email: "teste-hmo161-1790379476@hmoraes.com.br",
  senha: "PuloGato!1790379476",
};

async function entrar(conta) {
  const r = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: conta.email, password: conta.senha }),
  });
  const sessao = await r.json();
  if (!sessao.access_token) {
    throw new Error(`login de ${conta.nome} falhou: ${JSON.stringify(sessao)}`);
  }

  // O cookie do @supabase/ssr: `base64-` + a sessao INTEIRA em base64.
  const cookie =
    `sb-${REF}-auth-token=base64-` +
    Buffer.from(JSON.stringify(sessao)).toString("base64");

  return { ...conta, jwt: sessao.access_token, id: sessao.user.id, cookie };
}

async function rota(quem, caminho) {
  const r = await fetch(`${APP}${caminho}`, { headers: { Cookie: quem.cookie } });
  const texto = await r.text();
  try {
    return { status: r.status, corpo: JSON.parse(texto) };
  } catch {
    // 404 do Next vem em HTML: e assim que "a rota nao foi publicada ainda" se
    // parece, e e diferente de "a rota respondeu erro".
    return { status: r.status, corpo: { __html: texto.slice(0, 160) } };
  }
}

// ---------------------------------------------------------------------------
// METADE 1 -- o gesto no bundle publicado
// ---------------------------------------------------------------------------
// AS CINCO ANCORAS, e cada uma cobre uma parte diferente da entrega. Uma so
// (digamos, o `data-` do botao) passaria verde com o dialogo inteiro ausente --
// e o botao abriria um bloco que nao existe.
const ANCORAS = [
  // O botao, pela ancora que a sonda de navegador tambem usa.
  ["o botao do gesto", "data-antecipar-emprestimo"],
  // O dialogo, pela pergunta -- e ela e a decisao (a): QUANTAS, nao quantos reais.
  ["a pergunta do dialogo", "Quantas parcelas antecipar"],
  // O seletor de quantidade, que e onde a recusa de `mais_do_que_em_aberto`
  // passou a morar (na FORMA do campo).
  ["o seletor de quantas", "data-antecipar-quantas"],
  // A previa. Sem ela o botao abre um bloco que nao diz nada ANTES do clique.
  ["a previa do dialogo", "data-previa-antecipacao"],
  // A rota irma. Sem esta string o botao existe e nao chama nada -- e
  // `PATCH /api/mybank/loans/<id>` continua recusando todo corpo que nao seja
  // `{status:"cancelled"}`, entao nao ha caminho alternativo.
  ["a chamada da rota irma", "/antecipacao"],
  // O rotulo da parcela antecipada, pela ancora (e nao pela palavra: "antecipada"
  // aparece em frase de `lib/`, e casaria com o texto sem o `<span>` existir).
  ["o rotulo da parcela antecipada", "data-antecipadas"],
];

/**
 * O CONTROLE POSITIVO DO GREP, e ele e o passo que faltava na primeira medicao.
 *
 * `data-cancelar-emprestimo` esta publicado desde a HMO-391. Se ELE nao aparecer,
 * o relatorio nao esta medindo o deploy: esta medindo o proprio script -- foi
 * exatamente o que aconteceu aqui, com a extracao de chunks parando no `(` de
 * `app/(dashboard)` e devolvendo 21 chunks sem o da tela. As cinco ancoras da F4
 * sairam "FALTA" sobre um deploy que tinha subido.
 */
const CONTROLE_POSITIVO = ["o Cancelar, publicado desde a HMO-391", "data-cancelar-emprestimo"];

async function chunksDaTela(quem) {
  const r = await fetch(`${APP}/dashboard/mybank`, {
    headers: { Cookie: quem.cookie },
  });
  const html = await r.text();

  if (r.status !== 200) {
    throw new Error(`/dashboard/mybank respondeu ${r.status}`);
  }

  // As URLs dos chunks saem do HTML da propria pagina, e NAO do
  // `app-build-manifest.json`: ele nao e servido em producao
  // (`app-build-manifest-nao-e-servido-em-prod`). E nao do build local: o hash
  // do chunk daqui nao bate com o da Vercel
  // (`hash-de-chunk-local-nao-bate-com-a-vercel`).
  //
  // O CHUNK DA TELA NAO ESTA NUM `<script src>`: ELE ESTA NO PAYLOAD DO RSC
  // ----------------------------------------------------------------------
  // Os `<script>` do HTML trazem o layout e os chunks compartilhados. O chunk do
  // `PainelDoMyBank` aparece so dentro do flight do React, numa string JSON
  // escapada:
  //
  //   "static/chunks/app/(dashboard)/dashboard/mybank/page-<hash>.js","PainelDoMyBank"
  //
  // Dai duas consequencias no regex, e as duas foram pagas: ele e ancorado em
  // `static/chunks/` (sem a barra inicial, que no flight nao existe) e ACEITA
  // parentese -- a primeira versao usava `[^"'\\\s]+?`, parava no `(` de
  // `app/(dashboard` e devolvia 21 chunks em vez de 26, nenhum deles o da tela.
  // O controle positivo e o que pega esse caso.
  const urls = Array.from(
    new Set(
      Array.from(
        html.matchAll(/static\/chunks\/(?:[A-Za-z0-9_\-().\/]|\\?)+?\.js/g)
      ).map((m) => "/_next/" + m[0])
    )
  );

  if (urls.length === 0) {
    throw new Error("nenhum chunk no HTML de /dashboard/mybank");
  }

  const fontes = [];
  for (const url of urls) {
    const resp = await fetch(`${APP}${url}`);
    if (!resp.ok) continue;
    fontes.push({ url, fonte: await resp.text() });
  }

  return fontes;
}

// ---------------------------------------------------------------------------
// METADE 2 -- em quais linhas o gesto aparece
// ---------------------------------------------------------------------------
const EM_ABERTO = ["pending", "reported"];

/** A MESMA condicao de `podeAntecipar`, dita aqui para o relatorio a imprimir. */
function previsaoDoGesto(emprestimo) {
  const emAberto = (emprestimo.parcelas ?? []).filter((p) =>
    EM_ABERTO.includes(p.status)
  ).length;

  return {
    id: emprestimo.id,
    descricao: emprestimo.descricao,
    status: emprestimo.status,
    emAberto,
    // O gesto aparece? `active` **E** com parcela em aberto.
    gesto: emprestimo.status === "active" && emAberto > 0,
    // O Cancelar aparece? SO o status -- a diferenca que a F4 entrega.
    cancelar: emprestimo.status === "active",
    // As antecipadas, pelo criterio derivado: `paid_date < due_date`. O
    // `vencimento` e o nome que a rota da ao `due_date`.
    antecipadas: (emprestimo.parcelas ?? [])
      .filter(
        (p) => p.paid_date && p.vencimento && String(p.paid_date) < String(p.vencimento)
      )
      .map((p) => p.numero)
      .sort((a, b) => a - b),
    progresso: `${(emprestimo.parcelas ?? []).filter((p) => p.status === "paid").length}/${emprestimo.total_de_parcelas}`,
  };
}

// ---------------------------------------------------------------------------

const falhas = [];

console.log("MEDICAO EM PRODUCAO -- o gesto de antecipar (HMO-397)\n");
console.log(APP, "\n");

const a = await entrar(CONTA_A);
console.log(`entrei como ${a.nome} (${a.id})\n`);

// --- METADE 1 ---------------------------------------------------------------
console.log("METADE 1 -- o gesto no bundle PUBLICADO");
console.log("---------------------------------------");

const fontes = await chunksDaTela(a);
console.log(`${fontes.length} chunk(s) de /dashboard/mybank lidos de producao\n`);

// O CONTROLE POSITIVO VEM PRIMEIRO, e ele decide se o resto vale alguma coisa.
const [rotuloDoControle, ancoraDoControle] = CONTROLE_POSITIVO;
const controleAchado = fontes.some((f) => f.fonte.includes(ancoraDoControle));
console.log(
  `  ${controleAchado ? "OK  " : "FALHA"} controle positivo: ${rotuloDoControle} ` +
    `(${JSON.stringify(ancoraDoControle)}) ${controleAchado ? "esta no chunk" : "NAO esta no chunk"}`
);
if (!controleAchado) {
  falhas.push(
    "o controle positivo falhou: `data-cancelar-emprestimo` esta publicado desde a " +
      "HMO-391 e nao apareceu. O script nao esta lendo o chunk da tela -- as " +
      "ancoras da F4 abaixo nao medem o deploy, medem o proprio script."
  );
}
console.log("");

for (const [rotulo, ancora] of ANCORAS) {
  const onde = fontes.filter((f) => f.fonte.includes(ancora));
  const ok = onde.length > 0;
  console.log(
    `  ${ok ? "OK  " : "FALTA"} ${rotulo}  (${JSON.stringify(ancora)})` +
      (ok ? ` -> ${onde[0].url.split("/").pop()}` : "")
  );
  if (!ok) falhas.push(`a ancora ${JSON.stringify(ancora)} (${rotulo}) nao esta no chunk publicado`);
}

// CONTROLE NEGATIVO DO GREP. Sem ele, um `includes` que devolvesse `true` para
// tudo (ou um chunk lido como string vazia virando `""` que casa com `""`) faria
// as cinco ancoras acima passarem sem medir nada.
const INVENTADA = "data-antecipar-emprestimo-que-nao-existe";
const inventadaAchada = fontes.some((f) => f.fonte.includes(INVENTADA));
console.log(
  `\n  ${inventadaAchada ? "FALHA" : "OK  "} controle negativo: a ancora INVENTADA ` +
    `${JSON.stringify(INVENTADA)} ${inventadaAchada ? "APARECEU" : "nao aparece"}`
);
if (inventadaAchada) {
  falhas.push("o controle negativo do grep achou uma ancora inventada");
}

// --- METADE 2 ---------------------------------------------------------------
console.log("\nMETADE 2 -- em quais linhas o gesto aparece");
console.log("-------------------------------------------");

const loans = await rota(a, "/api/mybank/loans");
if (loans.status !== 200) {
  throw new Error(
    `GET /api/mybank/loans respondeu ${loans.status}: ${JSON.stringify(loans.corpo).slice(0, 200)}`
  );
}

const linhas = (loans.corpo.loans ?? []).map(previsaoDoGesto);

if (linhas.length === 0) {
  falhas.push(
    "a conta de teste nao tem emprestimo nenhum: nada a medir " +
      "(`prod-vazia-invalida-prova-por-efeito-colateral`). Rode primeiro " +
      "`node scripts/medicao-antecipacao-do-mybank.mjs`, que cria a serie."
  );
}

for (const l of linhas) {
  console.log(
    `  ${l.id.slice(0, 8)}  ${l.status.padEnd(9)} ` +
      `${String(l.emAberto).padStart(2)} em aberto  ${l.progresso.padEnd(7)} ` +
      `gesto=${l.gesto ? "SIM" : "nao"}  cancelar=${l.cancelar ? "SIM" : "nao"}  ` +
      `antecipadas=[${l.antecipadas.join(",")}]  ${l.descricao}`
  );
}

// AS TRES AFIRMACOES QUE A ISSUE PEDE, cada uma com a linha que a sustenta.
const comGesto = linhas.filter((l) => l.gesto);
const quitados = linhas.filter((l) => l.status !== "active");
const ativoSemAberto = linhas.filter((l) => l.status === "active" && l.emAberto === 0);
const comAntecipada = linhas.filter((l) => l.antecipadas.length > 0);

console.log("");
console.log(
  `  ${comGesto.length > 0 ? "OK  " : "FALTA"} o gesto aparece no \`active\` com parcela em aberto ` +
    `(${comGesto.length} linha(s))`
);
if (comGesto.length === 0) {
  falhas.push(
    "nenhum emprestimo `active` com parcela em aberto na conta de teste: " +
      "o caso POSITIVO do gesto nao esta medido"
  );
}

console.log(
  `  ${quitados.every((l) => !l.gesto) ? "OK  " : "FALHA"} o gesto NAO aparece em emprestimo fora de \`active\` ` +
    `(${quitados.length} linha(s): ${quitados.map((l) => l.status).join(", ") || "nenhuma"})`
);
if (quitados.length === 0) {
  console.log(
    "       (sem emprestimo `settled`/`cancelled` na conta: este caso nao foi medido AQUI. " +
      "Ele esta medido em CI, no K1 da sonda de navegador, com os dois estados no fixture.)"
  );
}

// A DIFERENCA ENTRE AS DUAS CONDICOES, que e a entrega da F4. Ela so e medivel
// em producao se existir um `active` SEM nada em aberto -- e e normal nao
// existir: desde a HMO-394 quem paga a ultima parcela vira `settled`.
if (ativoSemAberto.length > 0) {
  const certo = ativoSemAberto.every((l) => !l.gesto && l.cancelar);
  console.log(
    `  ${certo ? "OK  " : "FALHA"} o \`active\` SEM nada em aberto tem Cancelar e NAO tem Antecipar ` +
      `(${ativoSemAberto.length} linha(s))`
  );
  if (!certo) falhas.push("um `active` sem nada em aberto ofereceu o gesto de antecipar");
} else {
  console.log(
    "  --   nenhum `active` SEM nada em aberto na conta: a DIFERENCA entre as duas " +
      "condicoes nao foi medida aqui."
  );
  console.log(
    "       Ela esta medida em CI (K1), com `l-k-pago` e `l-k-cancelado` no fixture -- " +
      "e e esperado nao haver um aqui: desde a HMO-394 o ciclo de pagamento escreve `settled`."
  );
}

console.log(
  `  ${comAntecipada.length > 0 ? "OK  " : "--  "} a parcela antecipada se distingue ` +
    `(${comAntecipada.length} linha(s)): ` +
    (comAntecipada
      .map((l) => `${l.id.slice(0, 8)} ${l.progresso} antecipadas=[${l.antecipadas.join(",")}]`)
      .join("; ") || "nenhuma -- rode a medicao da F2/F3 para criar uma")
);
if (comAntecipada.length === 0) {
  falhas.push(
    "nenhuma parcela com `paid_date < due_date` na conta de teste: o rotulo de " +
      "antecipada nao esta medido em producao. Rode " +
      "`node scripts/medicao-antecipacao-do-mybank.mjs` antes deste script."
  );
}

// A LEITURA QUE O ROTULO EXPLICA, impressa junto: `progresso` com parcela
// pendente mais antiga que as pagas e exatamente o que pedia explicacao.
for (const l of comAntecipada) {
  console.log(
    `       ${l.id.slice(0, 8)}: progresso ${l.progresso} com ${l.emAberto} em aberto -- ` +
      "e o rotulo e o que diz por que."
  );
}

// --- o veredito -------------------------------------------------------------
console.log("\n=====================================================");
if (falhas.length === 0) {
  console.log("MEDICAO OK: o gesto esta publicado, e aparece onde deve.");
} else {
  console.log(`MEDICAO COM ${falhas.length} PROBLEMA(S):`);
  for (const f of falhas) console.log(`  - ${f}`);
}
console.log("=====================================================");

// Sai 1 com problema: um script que saisse 0 provaria o mesmo que script nenhum.
process.exit(falhas.length === 0 ? 0 : 1);
