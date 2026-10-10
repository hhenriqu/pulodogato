#!/usr/bin/env node
// Prova de mutacao do portao de conexao (HMO-373).
//
//   node scripts/mutantes-portao-de-conexao.mjs
//
// Cada entrada estraga UMA decisao; `npm run test:portao-de-conexao` tem de
// ficar VERMELHA em todas. Mutante que sobrevive e um trecho que nenhuma
// assercao distingue.
//
// O CONTROLE NEGATIVO DA ENTREGA E O PRIMEIRO DA LISTA
// ----------------------------------------------------
// `O FILTRO VOLTA A SER .eq(...)` devolve exatamente o estado da `main`: o
// perfil com `allow_connections` NULO fica invisivel na busca. E o mutante que
// a issue pede nominalmente, e se ele sobrevive nenhum outro compensa -- a
// suite nao estaria medindo a feature.
//
// POR QUE ELE MORA NA ROTA, E NAO EM `aplicarPortaoDeConexao`
// ----------------------------------------------------------
// A tentacao e mutar o corpo do helper:
//
//     return consulta.not("allow_connections", "is", false);
//  -> return consulta.eq("allow_connections", true);
//
// Isso NAO mede nada. O parametro e generico (`Q extends { not(...): Q }`), ou
// seja o tipo nao promete um `.eq`, e o mutante morre no `tsc` do passo de
// compilacao em vez de morrer numa assercao. Um mutante que morre no compilador
// e indistinguivel de um mutante que a suite pegou, e o placar passa a contar
// erro de tipo como cobertura (e a familia de
// `mutante-de-retrocesso-morre-no-tsc-nao-na-assercao`).
//
// No CALL SITE da rota o encadeamento e o do supabase-js de verdade, onde
// `.eq("allow_connections", true)` tipa perfeitamente -- entao o mutante
// compila, roda, e e a assercao que o mata. E de lambuja ele deixa
// `aplicarPortaoDeConexao` IMPORTADO e usado no caminho do e-mail, o que o
// torna tambem a prova de que um guard de fiacao (`includes("aplicarPortao")`)
// nao serviria aqui.
//
// A FAMILIA "CONSERTOU DEMAIS"
// ----------------------------
// Afrouxar o portao conserta o NULL e abre o `false`, e a diferenca nao
// aparece em nenhuma tela: os dois estados somem no mesmo "o perfil aparece".
// `O PORTAO E APAGADO` e `O PORTAO VIRA is.null` sao esses dois, e e o controle
// negativo da suite (o perfil `false`) que os distingue do conserto.
//
// A FAMILIA DO E-MAIL E A QUE PODE VIRAR VAZAMENTO
// ------------------------------------------------
// `get_user_by_email` nao sabe de `is_public` nem de `allow_connections` -- ela
// devolve qualquer conta confirmada. Entao os mutantes que tiram um dos dois
// portoes da RELEITURA de `profiles`, ou que devolvem a linha da funcao direto,
// transformam a busca num oraculo de "este e-mail tem conta no app". Eles sao a
// razao de a feature de e-mail ter releitura em vez de usar a resposta da RPC.
//
// A FORMA DA LISTA E A DA FAMILIA TUPLA DE ARIDADE 4
// -------------------------------------------------
// `scripts/mede-ancora-ambigua.mjs` -- a guarda que reprova ancora morta,
// ambigua ou de arquivo inexistente em TODO runner do repo -- le a lista de
// verdade em vez de a copiar, e so sabe ler duas formas. Dai a ordem
// `[alvo, rotulo, de, para]` e o `original` montado DEPOIS da lista. As ancoras
// sao strings de uma linha com `\n` escapado, nunca template literal: o leitor
// da primeira entrada conta linhas de nivel 4 para cruzar a aridade.
import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const BUSCA = "app/api/users/search/route.ts";
const CONEXOES = "app/api/connections/route.ts";
const LIB = "lib/busca-de-perfil.ts";

/** [alvo, rotulo, de, para] */
const mutantes = [
  // =========================================================================
  // A ENTREGA: o filtro volta a ser `.eq(...)` -- o estado da `main`
  // =========================================================================
  [
    BUSCA,
    "O FILTRO VOLTA A SER .eq(allow_connections, true) (o estado da main: o perfil NULO fica invisivel)",
    '    const { data: porNome, error } = await aplicarPortaoDeConexao(\n      supabase\n        .from("profiles")\n        .select(PUBLIC_PROFILE_FIELDS)\n        .or(filtroDeNome)\n        .eq("is_public", true)\n        .neq("id", user.id)\n    ).limit(20);',
    '    const { data: porNome, error } = await supabase\n      .from("profiles")\n      .select(PUBLIC_PROFILE_FIELDS)\n      .or(filtroDeNome)\n      .eq("is_public", true)\n      .eq("allow_connections", true)\n      .neq("id", user.id)\n      .limit(20);',
  ],

  // =========================================================================
  // CONSERTOU DEMAIS: o portao afrouxado deixa passar quem DESLIGOU o botao
  // =========================================================================
  [
    LIB,
    "O PORTAO E APAGADO (conserta o NULL e expoe quem recusou de proposito)",
    '  return consulta.not("allow_connections", "is", false);',
    "  return consulta;",
  ],
  [
    LIB,
    "O PORTAO VIRA is.null: recusa o NULO e ADMITE o false -- exatamente invertido",
    '  return consulta.not("allow_connections", "is", false);',
    '  return consulta.not("allow_connections", "is", null);',
  ],
  [
    LIB,
    "`permiteConexao` volta ao `=== true`: o POST recusa o NULO que a policy admite",
    "  return valor !== false;",
    "  return valor === true;",
  ],

  // =========================================================================
  // O OUTRO PORTAO (`is_public`), que o conserto nao podia alargar
  // =========================================================================
  [
    BUSCA,
    "a busca por nome perde o portao `is_public`: perfil fechado entra na lista",
    '        .or(filtroDeNome)\n        .eq("is_public", true)\n        .neq("id", user.id)',
    "        .or(filtroDeNome)\n        .neq(\"id\", user.id)",
  ],

  // =========================================================================
  // O E-MAIL: cada portao que falte na RELEITURA e um vazamento
  // =========================================================================
  [
    BUSCA,
    "o e-mail devolve a linha da RPC direto: o portao nao e consultado E o e-mail vaza no corpo",
    '        const { data: perfil } = await aplicarPortaoDeConexao(\n          supabase\n            .from("profiles")\n            .select(PUBLIC_PROFILE_FIELDS)\n            .eq("id", idDaConta)\n            .eq("is_public", true)\n        ).maybeSingle();',
    "        const perfil = (contas as { id: string }[] | null)?.[0] as unknown as (typeof achados)[number];",
  ],
  [
    BUSCA,
    "a releitura do e-mail perde o portao de conexao: quem recusou aparece por e-mail",
    '        const { data: perfil } = await aplicarPortaoDeConexao(\n          supabase\n            .from("profiles")\n            .select(PUBLIC_PROFILE_FIELDS)\n            .eq("id", idDaConta)\n            .eq("is_public", true)\n        ).maybeSingle();',
    '        const { data: perfil } = await supabase\n          .from("profiles")\n          .select(PUBLIC_PROFILE_FIELDS)\n          .eq("id", idDaConta)\n          .eq("is_public", true)\n          .maybeSingle();',
  ],
  [
    BUSCA,
    "a releitura do e-mail perde o `is_public`: perfil fechado achavel pelo e-mail",
    '            .eq("id", idDaConta)\n            .eq("is_public", true)',
    '            .eq("id", idDaConta)',
  ],
  [
    BUSCA,
    "o e-mail nao exclui a MIM: procurar o proprio e-mail me devolve a mim mesmo",
    "      if (idDaConta && idDaConta !== user.id) {",
    "      if (idDaConta) {",
  ],

  // =========================================================================
  // `pareceEmail`: o porteiro da ida extra
  // =========================================================================
  [
    LIB,
    "`pareceEmail` nunca reconhece e-mail: a feature inteira fica morta em silencio",
    "  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(limpo);",
    "  return false;",
  ],
  [
    LIB,
    "`pareceEmail` aceita qualquer termo: toda digitacao consulta get_user_by_email sobre auth.users",
    "  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(limpo);",
    "  return true;",
  ],

  // =========================================================================
  // O FILTRO CITADO (HMO-142), que esta rota tinha deixado passar
  // =========================================================================
  [
    BUSCA,
    "o filtro de nome volta a ser colado cru: nome com virgula quebra a arvore do PostgREST",
    "    const filtroDeNome = montarFiltroDeBusca(query);",
    "    const filtroDeNome = `full_name.ilike.%${query}%,nickname.ilike.%${query}%`;",
  ],

  // =========================================================================
  // O RECORTE QUE JA EXISTIA, e que a lista `achados` nova nao podia perder
  // =========================================================================
  [
    BUSCA,
    "a conexao JA existente deixa de ser filtrada: quem ja e contato volta para a busca",
    "      const filteredUsers = achados.filter((u) => !connectedUserIds.has(u.id));",
    "      const filteredUsers = achados;",
  ],

  // =========================================================================
  // O POST de conexao: o portao recusado tem de continuar recusando
  // =========================================================================
  [
    CONEXOES,
    "o POST para de consultar o portao: quem desligou o botao recebe pedido de conexao",
    "    if (!permiteConexao(targetProfile.allow_connections)) {",
    "    if (false) {",
  ],
];

const SUITE = "test:portao-de-conexao";

const bloco = criarBlocoDeMutantes({
  suites: [SUITE],
  rotulo: "portao-de-conexao",
});

// Lido da arvore de verdade, que e o original por construcao: nada mais aqui
// escreve nela. Montado DEPOIS da lista -- ver A FORMA DA LISTA, no cabecalho.
const original = new Map();
for (const arquivo of new Set(mutantes.map(([alvo]) => alvo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

// CONTROLE POSITIVO: a arvore limpa tem de passar. Sem ele, uma suite ja
// vermelha -- ou um erro de script -- deixaria TODO mutante aparecendo como
// morto e o placar sairia cheio sem medir nada.
const limpo = bloco.rodar("<arvore limpa>", {}, SUITE);
if (!limpo.verde) {
  console.error(
    "controle positivo REPROVOU: a suite ja esta vermelha sem mutante nenhum. " +
      "Todo mutante abaixo apareceria como MORTO sem medir nada."
  );
  bloco.fechar();
  process.exit(1);
}
console.log("controle positivo: arvore limpa VERDE.\n");

let mortos = 0;
const sobreviventes = [];

for (const [arquivo, rotulo, de, para] of mutantes) {
  const fonte = original.get(arquivo);
  const ocorrencias = fonte.split(de).length - 1;

  if (ocorrencias === 0) {
    console.error(
      `ANCORA MORTA  ${rotulo}\n  ${arquivo} nao contem o trecho procurado. ` +
        "Isto e erro do runner, nao mutante morto -- conserte a ancora."
    );
    bloco.fechar();
    process.exit(1);
  }

  // A TRAVA DE OCORRENCIA UNICA. `String.replace` troca a PRIMEIRA ocorrencia:
  // um `de` que aparece duas vezes muta um lugar que o rotulo nao descreve. O
  // risco e concreto aqui -- os comentarios destes arquivos CITAM as proprias
  // ancoras (`.eq("allow_connections", true)` aparece na prosa que explica por
  // que ela saiu), e uma ancora curta demais mutaria a explicacao e deixaria o
  // codigo intacto, com o placar dizendo "sobreviveu".
  if (ocorrencias > 1) {
    console.error(
      `ANCORA AMBIGUA  ${rotulo}\n  o trecho aparece ${ocorrencias}x em ${arquivo} ` +
        "-- o replace muta so a 1a. Isto e erro do runner; estreite a ancora."
    );
    bloco.fechar();
    process.exit(1);
  }

  const mutado = fonte.replace(de, para);

  if (mutado === fonte) {
    console.error(
      `MUTACAO NO-OP  ${rotulo}\n  o replace nao mudou o texto de ${arquivo}.`
    );
    bloco.fechar();
    process.exit(1);
  }

  const r = bloco.rodar(rotulo, { [arquivo]: mutado }, SUITE);

  if (!r.verde) {
    mortos += 1;
    console.log(`MORTO      ${rotulo}`);
  } else {
    sobreviventes.push(rotulo);
    console.log(`SOBREVIVEU ${rotulo}`);
    if (r.mudouASaida === false) {
      console.log(
        "           (saida compilada identica a da arvore limpa: EQUIVALENTE)"
      );
    }
  }
}

bloco.fechar();

console.log(`\n${mortos}/${mutantes.length} mortos.`);
if (sobreviventes.length > 0) {
  console.log("\nsobreviventes:");
  for (const s of sobreviventes) console.log(`  - ${s}`);
}

// Sai 1 com sobrevivente: um runner que saisse 0 deixaria o step de CI verde
// para sempre e provaria o mesmo que step nenhum.
process.exit(sobreviventes.length === 0 ? 0 : 1);
