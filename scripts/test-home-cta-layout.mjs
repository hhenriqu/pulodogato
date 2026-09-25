// =====================================================
// TESTES DO PAR DE BOTOES DA HOME (HMO-160)
// =====================================================
//   npm run test:home-cta
//
// O defeito que este arquivo existe para impedir:
//
//     <div className="space-x-4">
//       <Link href="/signup"><Button size="lg" className="px-8 py-3">Criar Conta Gratis</Button></Link>
//       <Link href="/login"><Button size="lg" className="px-8 py-3">Fazer Login</Button></Link>
//     </div>
//
// `space-x-4` NAO e gap. Ele vira `> * + * { margin-left: 1rem }` num
// container que nem flex e -- os dois <a> sao caixas em linha, e a linha
// quebra sozinha quando nao cabe. No desktop cabe, entao a tela fica
// impecavel para quem revisa. No celular (375px de viewport, 343px uteis
// depois do `px-4`) os dois botoes somam ~360px, a linha quebra, e ai:
//
//   - o segundo botao desce com `margin-left: 1rem` preso nele, entao as duas
//     bordas esquerdas NAO coincidem -- e o "desalinhados" do relato;
//   - `space-x-*` so afasta na horizontal, entao entre as duas linhas sobra o
//     espaco do line-height e nada mais -- o "sem espacamento entre eles".
//
// Nada nessa situacao da erro: o Tailwind gera a classe, o tsc passa, o
// `next build` passa, e a classe `space-x-4` continua parecendo "espacamento"
// para quem le o diff. O sintoma so existe abaixo de um certo viewport.
//
// E o mesmo desenho das armadilhas de migracao de classe que este repositorio
// ja pagou: opacidade dupla, hover no-op, group-hover achatado -- todas
// compilam em silencio. Por isso a verificacao le as classes em vez de
// confiar em quem revisa de janela larga.
//
// O que este teste NAO cobre: geometria de verdade. Nao ha navegador neste
// ambiente, entao ele afirma sobre as classes que produzem a geometria, nao
// sobre pixels. E um piso contra a regressao exata de HMO-160.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.join(import.meta.dirname, "..");
const HOME = path.join(RAIZ, "app/page.tsx");
const fonte = fs.readFileSync(HOME, "utf8");

/**
 * Os grupos de acao da home: cada `<div className="...">` que tem, logo
 * dentro, pelo menos dois `<Link>` embrulhando um `<Button>`.
 *
 * Deliberadamente textual e deliberadamente ancorado em `<Link` + `<Button`:
 * se alguem trocar o par de botoes por outra coisa, o grupo some da lista e o
 * teste de "achei pelo menos dois" abaixo fica vermelho, em vez de passar
 * verde por nao ter encontrado nada.
 */
function gruposDeBotoes(texto) {
  const grupos = [];
  const abertura = /<div className="([^"]*)">\s*\n((?:\s*<Link[\s\S]*?<\/Link>\s*\n)+)\s*<\/div>/g;

  for (const m of texto.matchAll(abertura)) {
    const classes = m[1].split(/\s+/).filter(Boolean);
    const corpo = m[2];
    const links = [...corpo.matchAll(/<Link\s+href="([^"]+)"/g)].map((l) => l[1]);
    if (links.length < 2) continue;
    if (!corpo.includes("<Button")) continue;
    grupos.push({ classes, links, corpo });
  }
  return grupos;
}

const grupos = gruposDeBotoes(fonte);

// ---------------------------------------------------------------------------
// CONTROLE POSITIVO
// ---------------------------------------------------------------------------
// Uma verificacao que nunca encontrou o alvo nao verifica nada. Se a regex
// acima quebrar (JSX reformatado, aspas trocadas, prettier com outra largura),
// `grupos` vem vazio e todos os `for` abaixo passam por vacuidade -- verde
// indistinguivel de correto. Este teste e o que impede isso.

test("a home tem os dois grupos de botoes que esta suite vigia", () => {
  assert.ok(
    grupos.length >= 2,
    `Esperava >= 2 grupos de botoes em app/page.tsx, achei ${grupos.length}. ` +
      `Ou a home mudou de forma, ou a regex desta suite parou de casar -- ` +
      `nos dois casos o resto do arquivo esta passando sem olhar nada.`,
  );

  const destinos = grupos.flatMap((g) => g.links);
  assert.ok(
    destinos.includes("/signup") && destinos.includes("/login"),
    `O par criar-conta/entrar e o alvo do HMO-160 e sumiu dos grupos: ${destinos.join(", ")}`,
  );
});

// ---------------------------------------------------------------------------
// O DEFEITO EXATO DO HMO-160
// ---------------------------------------------------------------------------

test("nenhum grupo de botoes usa space-x-* para se espacar", () => {
  for (const { classes, links } of grupos) {
    const culpada = classes.find((c) => /^(sm:|md:|lg:|xl:)?space-x-/.test(c));
    assert.equal(
      culpada,
      undefined,
      `O grupo [${links.join(", ")}] usa "${culpada}". space-x-* e margin-left: ` +
        `some quando a linha quebra no celular e ainda empurra o botao de baixo ` +
        `para a direita. Use "gap-*", que vale nos dois eixos.`,
    );
  }
});

test("todo grupo de botoes e flex com gap", () => {
  for (const { classes, links } of grupos) {
    assert.ok(
      classes.includes("flex"),
      `O grupo [${links.join(", ")}] nao e flex. Sem flex os <a> ficam em ` +
        `linha e quebram onde der, que e a origem do desalinhamento.`,
    );
    assert.ok(
      classes.some((c) => /^gap-\d/.test(c)),
      `O grupo [${links.join(", ")}] nao tem gap-*. O espaco entre os botoes ` +
        `precisa existir tambem na vertical, que e como eles ficam no celular.`,
    );
  }
});

test("no celular os botoes empilham; a partir de sm voltam lado a lado", () => {
  for (const { classes, links } of grupos) {
    assert.ok(
      classes.includes("flex-col"),
      `O grupo [${links.join(", ")}] nao empilha no celular (falta "flex-col"). ` +
        `Empilhado de proposito, as duas bordas esquerdas coincidem; quebrado ` +
        `por falta de espaco, nao coincidem.`,
    );
    assert.ok(
      classes.includes("sm:flex-row"),
      `O grupo [${links.join(", ")}] empilha e nunca volta para a linha ` +
        `(falta "sm:flex-row"). No desktop os dois botoes cabem lado a lado.`,
    );
  }
});

// ---------------------------------------------------------------------------
// LARGURA: o que faz as bordas coincidirem de verdade
// ---------------------------------------------------------------------------
// `flex-col` + `items-center` empilha centralizado, mas dois botoes de textos
// diferentes ("Criar Conta Gratis" e "Fazer Login") tem larguras diferentes --
// centralizados, as bordas continuam desencontradas. Empilhados, eles precisam
// ocupar a mesma largura. O <Link> vira o filho do flex, entao a largura
// precisa estar NOS DOIS: no <a> e no <button> dentro dele.

test("empilhados, os botoes ocupam a mesma largura", () => {
  for (const { links, corpo } of grupos) {
    for (const m of corpo.matchAll(/<Link\s+href="([^"]+)"([^>]*)>/g)) {
      const [, href, resto] = m;
      assert.match(
        resto,
        /className="[^"]*\bw-full\b[^"]*"/,
        `O <Link href="${href}"> nao tem w-full: o <a> encolhe no texto e o ` +
          `<button> dentro dele nao tem como esticar.`,
      );
      assert.match(
        resto,
        /className="[^"]*\bsm:w-auto\b[^"]*"/,
        `O <Link href="${href}"> nao tem sm:w-auto: no desktop os dois botoes ` +
          `viram uma faixa de ponta a ponta.`,
      );
    }

    for (const m of corpo.matchAll(/<Button([^>]*)>/g)) {
      assert.match(
        m[1],
        /className="[^"]*\bw-full\b[^"]*"/,
        `Um <Button> do grupo [${links.join(", ")}] nao tem w-full. O <a> ` +
          `esticou, o botao dentro dele nao -- e a borda continua desencontrada.`,
      );
    }
  }
});
