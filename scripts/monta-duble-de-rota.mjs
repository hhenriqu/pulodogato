#!/usr/bin/env node
// =====================================================
// PULODOGATO - troca os clients do Supabase por dubles na arvore compilada
// =====================================================
//   node scripts/monta-duble-de-rota.mjs .tmp-semeadura
//
// Irmao do resolve-aliases.mjs e do resolve-next-subpaths.mjs: um passo de build
// que existe para o JS emitido de um route handler RODAR no node limpo.
//
// A ROTA NAO E REESCRITA -- AS DUAS DEPENDENCIAS DELA SAO SUBSTITUIDAS
// -------------------------------------------------------------------
// Esta e a distincao que faz a sonda valer alguma coisa. Nada no `route.js`
// compilado e tocado: ele continua escrevendo `createClient()` e
// `createClient(url, serviceRole, ...)` como escreveu no fonte. O que muda e o
// MODULO que esses dois nomes vem de:
//
//   1. `<tmp>/utils/supabase/server.js` -- o emit do modulo real, sobrescrito.
//      Ele importa `next/headers`, que nao roda fora do runtime do Next;
//   2. `<tmp>/node_modules/@supabase/supabase-js/` -- um pacote plantado DENTRO
//      da arvore compilada. A resolucao ESM de especificador nu sobe diretorio
//      por diretorio a partir de quem importa, entao este ganha do
//      node_modules/ do projeto, sem flag nenhuma e sem mexer no do projeto.
//
// Se um dia a rota trocar o jeito de obter o client -- `createServerClient`
// direto, outro pacote, um helper novo --, o duble deixa de ser consultado e o
// `globalThis.__dubleDeSupabase` fica sem uso. A sonda NAO descobriria isso
// sozinha (ela veria uma resposta qualquer), e por isso os dois dubles abaixo
// CONTAM as chamadas, e o teste exige que as duas contagens sejam > 0. Ver o
// controle positivo em scripts/test-semeadura-pela-renda.mjs.
//
// O no-op e erro, como nos irmaos: um arquivo esperado que nao existe significa
// que o tsc mudou a emissao, e o sintoma sem esta verificacao seria um
// ERR_MODULE_NOT_FOUND tres comandos depois, ou pior -- o modulo de verdade
// carregando e a sonda medindo rede.
// =====================================================

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [destino] = process.argv.slice(2);

if (!destino) {
  console.error("uso: node scripts/monta-duble-de-rota.mjs <dir-compilado>");
  process.exit(1);
}

const alvoDaSessao = join(destino, "utils/supabase/server.js");

if (!existsSync(alvoDaSessao)) {
  console.error(
    `monta-duble-de-rota: ${alvoDaSessao} nao existe. O tsc deixou de emitir o ` +
      "modulo do client de sessao (rootDir? include?), e sem a substituicao a " +
      "rota tentaria carregar `next/headers` no node."
  );
  process.exit(1);
}

/**
 * O duble vive num global em vez de num modulo importado pelos dois lados: o
 * teste precisa TROCAR as linhas entre uma chamada e a seguinte (o membro A
 * pedindo, depois o membro B), e um binding de modulo nao se reatribui de fora.
 */
const PREAMBULO = `// GERADO por scripts/monta-duble-de-rota.mjs -- nao editar.
function duble(qual) {
  const d = globalThis.__dubleDeSupabase;
  if (!d || typeof d[qual] !== "function") {
    throw new Error(
      "duble-de-supabase: globalThis.__dubleDeSupabase." + qual + " nao foi " +
        "instalado. A sonda tem que montar o duble ANTES de importar a rota."
    );
  }
  return d;
}
`;

writeFileSync(
  alvoDaSessao,
  `${PREAMBULO}
// O client da SESSAO -- o que roda com RLS, e o que diz quem a pessoa e.
export const createClient = () => {
  const d = duble("sessao");
  d.chamadasDeSessao = (d.chamadasDeSessao ?? 0) + 1;
  return d.sessao();
};
`
);

const pacote = join(destino, "node_modules/@supabase/supabase-js");
mkdirSync(pacote, { recursive: true });

writeFileSync(
  join(pacote, "package.json"),
  `${JSON.stringify(
    {
      name: "@supabase/supabase-js",
      version: "0.0.0-duble",
      type: "module",
      main: "index.js",
      exports: { ".": "./index.js" },
    },
    null,
    2
  )}\n`
);

writeFileSync(
  join(pacote, "index.js"),
  `${PREAMBULO}
// O client da SERVICE ROLE -- o que le a receita dos outros membros.
//
// Os argumentos sao GUARDADOS, nao descartados: a sonda confere que a rota passou
// a URL e a chave que leu do ambiente. Uma rota que construisse o client
// privilegiado com string vazia "funcionaria" aqui sem isso.
export const createClient = (url, chave, opcoes) => {
  const d = duble("servico");
  d.chamadasDeServico = (d.chamadasDeServico ?? 0) + 1;
  d.argumentosDoServico = { url, chave, opcoes };
  return d.servico();
};
`
);

console.log(
  `monta-duble-de-rota: dubles instalados em ${alvoDaSessao} e ${pacote}.`
);
