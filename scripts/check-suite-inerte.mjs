#!/usr/bin/env node
// A QUARTA PENEIRA: o workflow que roda a suite DA PARTIDA?
//
// O `check-tests-in-ci.mjs` tem tres peneiras e todas perguntam sobre
// DECLARACAO: existe `npm run <suite>` em algum workflow (1a), o `paths:` daquele
// workflow cita os arquivos que ela exercita (2a), dois alvos nao disputam o
// mesmo outDir (3a). Nenhuma pergunta se o GitHub cria job para o arquivo.
//
// Em 2026-10-20 essa diferenca custou 290 steps. O `verificacao.yml` passou de
// 512.000 bytes (HMO-473), o GitHub parou de criar job, e por 7 horas e 11 PRs
// nada ficou vermelho -- porque as tres peneiras continuaram verdes. A suite
// existia, estava citada, o `paths:` casava, e ela nao rodava. "Verde por
// ausencia" tem dois andares e as guardas conheciam so o de baixo.
//
// Pior: `check-tests-in-ci` e ele mesmo invocado SO no `verificacao.yml`
// (linha 177). As seis mencoes dele no `db-verify.yml` sao todas comentario. A
// guarda contra "declarado e nao roda" esta, ela propria, declarada e nao
// rodando. Por isso ESTE arquivo nao e uma quarta funcao dentro dele: e um
// arquivo separado, com step proprio no `db-verify.yml`, que da partida.
//
// O criterio vem do `mapa-de-cobertura.mjs` (importado, nao copiado). Uma
// segunda definicao de "roda" divergiria da primeira, e divergir calado e o
// modo de falha que este arquivo existe para impedir.
//
// O que ele NAO cobre: step que chama a suite e ignora o codigo de saida, suite
// que nao afirma nada, e job que o GitHub cria e pula por `if:`. Isto e um piso.

import { mapaDeCobertura, TETO_DE_BYTES_DO_WORKFLOW } from "./mapa-de-cobertura.mjs";

/**
 * O TETO da divida herdada: quantos alvos podem estar INERTE ou ORFAO.
 *
 * MEDIDO em 2026-10-22 na main `67b4ff8`: 80 inertes + 7 orfaos = 87.
 *
 * ESTE NUMERO SO DESCE. Ele nao e uma meta, e um catraca: enquanto a HMO-473
 * nao baixar o `verificacao.yml` para menos de 512.000 bytes, os 87 continuam
 * parados -- e o que esta guarda impede e o 88o. Era exatamente essa a
 * regressao das HMO-448, HMO-471 e HMO-482: cada uma registrou step novo no
 * `verificacao.yml` porque aquele e o lugar "natural" (junto da suite irma), o
 * `check-tests-in-ci` passou, e a suite nasceu morta.
 *
 * Em 0 o teto deixa de ser placar e vira proibicao, que e a forma mais forte.
 */
const TETO_DE_ALVOS_PARADOS = 87;

const mapa = mapaDeCobertura();

// -------------------------------------------------------------------------
// Primeiro o estado dos workflows, porque e a CAUSA e cabe em tres linhas.
// -------------------------------------------------------------------------
const mortos = mapa.workflows.filter((w) => !w.daPartida);

for (const w of mapa.workflows) {
  const folga = TETO_DE_BYTES_DO_WORKFLOW - w.bytes;
  const nota = !w.daPartida
    ? `NAO DA PARTIDA -- ${(-folga).toLocaleString("pt-BR")} bytes acima do teto`
    : w.emAlarme
      ? `em alarme -- ${folga.toLocaleString("pt-BR")} bytes de folga`
      : `ok -- ${folga.toLocaleString("pt-BR")} bytes de folga`;
  console.log(`  ${w.nome.padEnd(20)} ${w.bytes.toLocaleString("pt-BR").padStart(9)} bytes  ${nota}`);
}

const parados = mapa.alvos.filter((a) => a.estado !== "RODA");

// -------------------------------------------------------------------------
// A catraca.
// -------------------------------------------------------------------------
if (parados.length > TETO_DE_ALVOS_PARADOS) {
  console.error(
    `\n${parados.length} alvos de verificacao nao rodam em CI, e o teto e ${TETO_DE_ALVOS_PARADOS}.\n` +
      `\nUm alvo parado PARECE cobertura: ele existe no package.json, esta citado\n` +
      `num workflow, e o \`check-tests-in-ci\` fica verde sobre ele. So que nenhum\n` +
      `job o executa, entao a regressao que ele pegaria passa em verde.\n`,
  );
  if (mortos.length > 0) {
    console.error(
      `A causa: ${mortos.map((w) => `${w.nome} esta com ${w.bytes.toLocaleString("pt-BR")} bytes`).join(", ")}, ` +
        `acima do teto\nMEDIDO de ${TETO_DE_BYTES_DO_WORKFLOW.toLocaleString("pt-BR")} bytes. ` +
        `Acima dele o GitHub nao cria job: o YAML esta\nvalido, o \`js-yaml\` carrega, e nenhum step roda. ` +
        `E a HMO-473.\n`,
    );
  }
  // NAO tente nomear "os novos" por `parados.slice(TETO)`: a lista esta em
  // ordem alfabetica, entao o excedente dela e a cauda do alfabeto e nao o que
  // o PR acrescentou. A primeira versao desta guarda fazia isso e acusava
  // `test:sed-dos-workflows` por um alvo chamado `check-sonda-491`. Quem sabe
  // qual e o novo e o diff, entao a mensagem manda ao diff.
  // E `git diff`, nao `git stash`: neste repositorio o worktree e compartilhado
  // com outros runs e `git stash` ja corrompeu `refs/stash` a ponto de quebrar o
  // `fetch`. Uma mensagem de guarda nao pode mandar mexer na arvore.
  console.error(
    `Sao ${parados.length - TETO_DE_ALVOS_PARADOS} alvo(s) a mais que o teto, e eles estao\n` +
      `no seu proprio diff:\n` +
      `  git diff -- package.json .github/workflows/\n` +
      `Procure o alvo que voce acrescentou e o workflow em que o registrou.\n`,
  );

  const orfaos = parados.filter((a) => a.estado === "ORFAO");
  if (orfaos.length > 0) {
    console.error(`Os ${orfaos.length} ORFAOS -- nenhum workflow os cita, nem morto:\n`);
    for (const a of orfaos) console.error(`  ${a.nome}`);
    console.error("");
  }

  console.error(
    `O conserto NAO e subir o teto. Registre o step num workflow que da partida\n` +
      `(hoje: ${mapa.workflows.filter((w) => w.daPartida).map((w) => w.nome).join(", ")}),\n` +
      `lembrando que isso ELEGE aquele workflow como dono do \`paths:\` e cobra os\n` +
      `arquivos exercitados nos DOIS gatilhos (push e pull_request).\n` +
      `Rode \`npm run mapa-de-cobertura\` para ver o mapa inteiro.`,
  );
  process.exit(1);
}

if (parados.length < TETO_DE_ALVOS_PARADOS) {
  console.error(
    `\n${parados.length} alvos parados, abaixo do teto de ${TETO_DE_ALVOS_PARADOS}: ` +
      `baixe TETO_DE_ALVOS_PARADOS para ${parados.length}\n` +
      `em scripts/check-suite-inerte.mjs. O teto so desce -- deixa-lo alto devolve ` +
      `a folga que acabou de ser paga.`,
  );
  process.exit(1);
}

const rodando = mapa.alvos.length - parados.length;
console.log(
  `\n${rodando} de ${mapa.alvos.length} alvos de verificacao rodam em workflow que da partida. ` +
    `Os ${parados.length} parados estao no teto (${TETO_DE_ALVOS_PARADOS}), nao acima.`,
);
process.exit(0);
