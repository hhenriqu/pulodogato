// =====================================================
// TESTES DA DECISAO DE CONVITE DE INSTALACAO
// =====================================================
//   npm run test:pwa-install
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  decidirConvite,
  detectarIOS,
  lerDispensa,
  DIAS_DE_SILENCIO,
  CHAVE_DISPENSA,
} from "../.tmp-pwa-install/pwa-install.js";

const DIA = 86_400_000;
const AGORA = Date.UTC(2026, 8, 25, 12, 0, 0);

/** Estado base: Android com o prompt na mao, nada dispensado. */
const base = {
  standalone: false,
  ehIOS: false,
  temPromptNativo: true,
  dispensadoEm: null,
  agora: AGORA,
};

// ---------------------------------------------------------------------------
// decidirConvite
// ---------------------------------------------------------------------------

test("Android com prompt nativo recebe o banner de um toque", () => {
  assert.equal(decidirConvite(base), "nativo");
});

test("iOS recebe a instrucao, mesmo SEM prompt nativo", () => {
  // O caso que nao existia. No Safari `beforeinstallprompt` nunca chega, entao
  // a condicao antiga (so o evento) dava "nenhum" para todo iPhone.
  assert.equal(
    decidirConvite({ ...base, ehIOS: true, temPromptNativo: false }),
    "ios"
  );
});

test("desktop sem prompt nativo nao recebe convite nenhum", () => {
  // Mostrar "instale este app" onde nao ha como instalar ensina a ignorar o
  // banner -- e o proximo, que seria util, tambem seria ignorado.
  assert.equal(
    decidirConvite({ ...base, temPromptNativo: false }),
    "nenhum"
  );
});

test("dentro do app instalado nao ha convite, em nenhuma plataforma", () => {
  for (const plataforma of [
    { ehIOS: true, temPromptNativo: false },
    { ehIOS: false, temPromptNativo: true },
  ]) {
    assert.equal(
      decidirConvite({ ...base, ...plataforma, standalone: true }),
      "nenhum",
      `standalone deveria calar o convite em ${JSON.stringify(plataforma)}`
    );
  }
});

test("standalone vence ate quando o prompt nativo esta presente", () => {
  // A ordem importa: se a checagem do prompt viesse antes, o app instalado
  // convidaria a instalar a si mesmo.
  assert.equal(
    decidirConvite({ ...base, standalone: true, temPromptNativo: true }),
    "nenhum"
  );
});

test('"Agora nao" cala o convite pelo prazo, e so por ele', () => {
  const ontem = AGORA - 1 * DIA;
  assert.equal(decidirConvite({ ...base, dispensadoEm: ontem }), "nenhum");

  const dentroDoPrazo = AGORA - (DIAS_DE_SILENCIO - 1) * DIA;
  assert.equal(decidirConvite({ ...base, dispensadoEm: dentroDoPrazo }), "nenhum");

  const vencido = AGORA - (DIAS_DE_SILENCIO + 1) * DIA;
  assert.equal(decidirConvite({ ...base, dispensadoEm: vencido }), "nativo");
});

test("a dispensa vale para o convite do iOS tambem", () => {
  // Onde mais importa: o iOS nao tem evento `appinstalled`, entao quem
  // instalou e voltou ao Safari veria o convite para sempre sem a dispensa.
  assert.equal(
    decidirConvite({
      ...base,
      ehIOS: true,
      temPromptNativo: false,
      dispensadoEm: AGORA - 2 * DIA,
    }),
    "nenhum"
  );
});

test("carimbo de dispensa no futuro nao silencia para sempre", () => {
  // Relogio do aparelho adiantado (fuso errado, data trocada a mao). Sem o
  // `dias >= 0`, um carimbo de 2030 calaria o convite ate 2030.
  assert.equal(
    decidirConvite({ ...base, dispensadoEm: AGORA + 400 * DIA }),
    "nativo"
  );
});

// ---------------------------------------------------------------------------
// detectarIOS
// ---------------------------------------------------------------------------

test("detecta iPhone e iPad classico pelo user agent", () => {
  assert.equal(
    detectarIOS({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }),
    true
  );
  assert.equal(
    detectarIOS({ userAgent: "Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X)" }),
    true
  );
});

test("detecta iPadOS 13+, que se apresenta como Macintosh", () => {
  // O iPad moderno mente no user agent de proposito. Testar so por /iPad/
  // deixaria todo iPad recente sem NENHUM caminho de instalacao oferecido --
  // ele tambem nao tem `beforeinstallprompt`.
  assert.equal(
    detectarIOS({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
      maxTouchPoints: 5,
    }),
    true
  );
});

test("um Mac de verdade nao e confundido com iPad", () => {
  // O desempate e `maxTouchPoints`, que no Mac e 0. Sem ele, todo usuario de
  // macOS receberia instrucoes de iPhone.
  assert.equal(
    detectarIOS({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
      maxTouchPoints: 0,
    }),
    false
  );

  // Navegador que nao expoe maxTouchPoints tambem nao pode virar iPad.
  assert.equal(
    detectarIOS({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
    }),
    false
  );
});

test("Android e Windows nao sao iOS", () => {
  assert.equal(detectarIOS({ userAgent: "Mozilla/5.0 (Linux; Android 14)" }), false);
  assert.equal(
    detectarIOS({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", maxTouchPoints: 10 }),
    false
  );
});

// ---------------------------------------------------------------------------
// lerDispensa
// ---------------------------------------------------------------------------

test("lerDispensa devolve o numero gravado", () => {
  const armazenamento = { getItem: (k) => (k === CHAVE_DISPENSA ? "1750000000000" : null) };
  assert.equal(lerDispensa(armazenamento), 1750000000000);
});

test("lerDispensa trata vazio, lixo e zero como ausencia", () => {
  // `Number("")` e 0 -- um carimbo de 1970, dentro de nenhum prazo, mas que
  // passaria pelo `!== null` e mandaria a decisao pelo caminho errado.
  for (const bruto of ["", "abc", "0", "-5", "NaN"]) {
    assert.equal(
      lerDispensa({ getItem: () => bruto }),
      null,
      `${JSON.stringify(bruto)} deveria virar null`
    );
  }
});

test("lerDispensa nao propaga excecao de localStorage bloqueado", () => {
  // Safari em navegacao privada lanca SecurityError ao tocar em localStorage.
  // Propagar isso derrubaria a arvore do React por causa de um banner.
  const armazenamento = {
    getItem() {
      throw new Error("SecurityError");
    },
  };
  assert.equal(lerDispensa(armazenamento), null);
});
