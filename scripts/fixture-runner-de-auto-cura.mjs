#!/usr/bin/env node
// FIXTURE da suite `test:auto-cura` (HMO-326). Nao e um runner de verdade.
//
// E o menor runner de mutante possivel -- `protegerArvore`, aplica, roda a
// "suite", restaura -- e existe para a suite poder MATAR um runner no meio de
// um mutante sem gastar os minutos de uma suite real e sem tocar arquivo de
// fonte nenhum (o alvo e um fixture de texto).
//
// POR QUE A ESPERA E UM `execSync`, E NAO UM `setTimeout`
// -------------------------------------------------------
// O defeito que a HMO-326 fecha depende de a thread do JS estar BLOQUEADA: foi
// por isso que o handler de `SIGTERM` de `mutantes-painel-na-tela.mjs` foi
// ignorado por 2 minutos. Com `setTimeout` o loop de eventos esta livre, o
// sinal e entregue na hora, o gancho de `exit` roda e a arvore fica limpa --
// ou seja, o fixture passaria a medir um cenario que NAO e o do defeito, e a
// suite ficaria verde sem a auto-cura existir. Com `execSync` o bloqueio e o
// mesmo do laco real.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { protegerArvore } from "./auto-cura-de-mutante.mjs";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const ALVO = "scripts/fixture-auto-cura.txt";

const { originais, encerrar } = protegerArvore({
  runner: "fixture-auto-cura",
  arquivos: [ALVO],
});

writeFileSync(path.join(RAIZ, ALVO), originais[ALVO].replace("ORIGINAL", "MUTANTE"));
console.log("MUTANTE APLICADO");

// A suite mata o processo aqui, com a arvore mutada.
if (process.env.FIXTURE_TRAVA === "1") {
  execSync("sleep 120", { stdio: "ignore" });
}

encerrar();
console.log("FIM NORMAL");
