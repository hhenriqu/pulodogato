// =====================================================
// PULODOGATO - A VARREDURA DE FONTE QUE OS GUARDS TEXTUAIS COMPARTILHAM
// =====================================================
// Duas funcoes, as duas nascidas em scripts/check-embed-ambiguo.mjs (HMO-236) e
// extraidas na HMO-240, quando o segundo guard textual passou a precisar delas.
//
// POR QUE ELAS MORAM AQUI E NAO COPIADAS NOS DOIS
// -----------------------------------------------
// `semComentarios` e uma maquina de estados sobre string, aspas e escape -- o
// tipo de codigo em que uma copia divergente nao da erro: ela passa a deixar um
// pedaco de comentario de pe, o guard que a usa acusa o comentario que EXPLICA o
// defeito, e quem le conclui que o guard esta errado sobre o codigo. Uma copia
// so se descobre quando alguem conserta um dos dois lados.
// =====================================================

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * O fonte sem comentario nenhum, e sem estragar string nenhuma.
 *
 * Troca cada comentario por espacos do MESMO tamanho, para o numero de linha e
 * a coluna continuarem valendo no relatorio de quem chamou.
 *
 * Isto nao e refinamento: um guard textual que leia comentario acusa justamente
 * os arquivos CORRIGIDOS, porque e neles que o comentario cita o defeito em
 * prosa ("`CampoDeData` e nao o controle de data nativo"). O guard passaria a
 * reprovar o avesso do que mede.
 */
export function semComentarios(fonte) {
  let fora = "";
  let i = 0;
  let estado = "codigo"; // codigo | "  | '  | `  | //  | /*
  while (i < fonte.length) {
    const c = fonte[i];
    const d = fonte[i + 1];
    if (estado === "codigo") {
      if (c === "/" && d === "/") {
        estado = "//";
        fora += "  ";
        i += 2;
        continue;
      }
      if (c === "/" && d === "*") {
        estado = "/*";
        fora += "  ";
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") estado = c;
      fora += c;
      i++;
      continue;
    }
    if (estado === "//") {
      if (c === "\n") {
        estado = "codigo";
        fora += c;
      } else fora += " ";
      i++;
      continue;
    }
    if (estado === "/*") {
      if (c === "*" && d === "/") {
        estado = "codigo";
        fora += "  ";
        i += 2;
        continue;
      }
      fora += c === "\n" ? "\n" : " ";
      i++;
      continue;
    }
    // dentro de string: so a saida interessa, e `\` escapa o proximo
    if (c === "\\") {
      fora += c + (d ?? "");
      i += 2;
      continue;
    }
    if (c === estado) estado = "codigo";
    fora += c;
    i++;
  }
  return fora;
}

/** Todo `.ts`/`.tsx` debaixo de `raiz`, fora de `node_modules` e de dot-dir. */
export function arquivosDeFonte(raiz) {
  const achados = [];
  const andar = (dir) => {
    let entradas;
    try {
      entradas = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entradas) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      const caminho = join(dir, e);
      if (statSync(caminho).isDirectory()) andar(caminho);
      else if (/\.(ts|tsx)$/.test(e)) achados.push(caminho);
    }
  };
  andar(raiz);
  return achados;
}
