// Leitor de ZIP em Node puro, para o pacote anual da CVM.
//
// Por que existe, em vez de `unzip`: o ingestor roda onde nao ha binario de
// arquivo nenhum. Nem a Vercel (cron em serverless) nem este container de
// desenvolvimento tem `unzip`, `bsdtar`, `7z` ou `python3` -- medido em
// 2026-09-30, so `tar` e `gunzip`, e nenhum dos dois le ZIP. Um ingestor que
// dependesse de `unzip` funcionaria na maquina de quem escreveu e morreria em
// producao com "command not found", que e um erro de deploy, nao de codigo.
//
// O que ele faz: le o "central directory" do fim do arquivo (a lista oficial de
// entradas do formato) e descomprime a entrada pedida com `zlib.inflateRaw`,
// que e o mesmo DEFLATE que o ZIP usa. Nao e um leitor de ZIP completo -- e o
// subconjunto que o arquivo da CVM usa, e ele RECUSA o que nao entende em vez
// de devolver bytes pela metade.
//
// O que ele NAO cobre, de proposito:
//   - ZIP64 (arquivo > 4 GB ou > 65535 entradas). O pacote anual tem 19
//     entradas e ~12,8 MB comprimido; o maior CSV cru tem 64 MB. Se a CVM
//     passar a publicar ZIP64, `abrirZipCvm` lanca em vez de ler errado.
//   - entrada criptografada, ou metodo de compressao que nao seja
//     "armazenado" (0) ou DEFLATE (8).
//   - leitura em streaming. O ZIP inteiro entra na memoria. Cabe: 12,8 MB
//     comprimido, e cada CSV e descomprimido um por vez, sob demanda.
//
// So o ingestor (`scripts/ingest-cvm-fundamentos.mjs`) importa este modulo --
// nenhum componente de tela importa, por isso `node:zlib` no topo nao entra em
// bundle de browser.

import { inflateRawSync } from "node:zlib";

/** Uma entrada do pacote, como o central directory a descreve. */
export type EntradaZip = {
  readonly nome: string;
  /** 0 = armazenado, 8 = DEFLATE. Qualquer outro e recusado na extracao. */
  readonly metodo: number;
  readonly bytesComprimidos: number;
  /** Tamanho cru que o central directory DECLARA -- conferido na extracao. */
  readonly bytesDeclarados: number;
  readonly deslocamento: number;
};

export type ZipCvm = {
  readonly entradas: readonly EntradaZip[];
  /** Descomprime uma entrada pelo nome exato. Lanca se ela nao existe. */
  extrair(nome: string): Buffer;
};

const ASSINATURA_EOCD = 0x06054b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;

/** Comentario final do ZIP cabe em 16 bits, entao o EOCD esta nos ultimos ~64 KB. */
const JANELA_EOCD = 22 + 0xffff;

/**
 * O "end of central directory", procurado de tras para frente.
 *
 * De tras para frente porque o EOCD e o ULTIMO registro do arquivo e o formato
 * nao diz onde ele comeca -- o comentario que vem depois dele tem tamanho
 * livre. Procurar de frente acharia a assinatura dentro do conteudo comprimido
 * de algum CSV, que e ruido aleatorio e contem qualquer sequencia de 4 bytes.
 */
function acharEocd(buf: Buffer): number {
  const limite = Math.max(0, buf.length - JANELA_EOCD);
  for (let i = buf.length - 22; i >= limite; i--) {
    if (buf.readUInt32LE(i) === ASSINATURA_EOCD) return i;
  }
  throw new Error("ZIP invalido: nao achei o end-of-central-directory nos ultimos 64 KB.");
}

export function abrirZipCvm(buf: Buffer): ZipCvm {
  if (buf.length < 22) throw new Error(`ZIP invalido: ${buf.length} bytes e menos que um EOCD vazio.`);

  const eocd = acharEocd(buf);
  const totalEntradas = buf.readUInt16LE(eocd + 10);
  const inicioCentral = buf.readUInt32LE(eocd + 16);

  // ZIP64 sinaliza o estouro com 0xffff / 0xffffffff nesses mesmos campos. Nao
  // lemos o registro ZIP64; recusamos, porque a alternativa e ler 65535
  // entradas de um arquivo que tem mais e nunca perceber a falta.
  if (totalEntradas === 0xffff || inicioCentral === 0xffffffff) {
    throw new Error("ZIP64 nao suportado: o pacote estourou os campos de 32 bits do EOCD.");
  }

  const entradas: EntradaZip[] = [];
  let p = inicioCentral;

  for (let n = 0; n < totalEntradas; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== ASSINATURA_CENTRAL) {
      throw new Error(`ZIP invalido: central directory quebrado na entrada ${n} (offset ${p}).`);
    }
    const metodo = buf.readUInt16LE(p + 10);
    const bytesComprimidos = buf.readUInt32LE(p + 20);
    const bytesDeclarados = buf.readUInt32LE(p + 24);
    const tamNome = buf.readUInt16LE(p + 28);
    const tamExtra = buf.readUInt16LE(p + 30);
    const tamComentario = buf.readUInt16LE(p + 32);
    const deslocamento = buf.readUInt32LE(p + 42);

    // Os nomes das entradas da CVM sao ASCII (`dfp_cia_aberta_DRE_con_2025.csv`).
    // latin1 e o fallback correto do formato quando a flag de UTF-8 nao esta
    // ligada, e para ASCII os dois dao o mesmo resultado.
    const nome = buf.toString("latin1", p + 46, p + 46 + tamNome);

    entradas.push({ nome, metodo, bytesComprimidos, bytesDeclarados, deslocamento });
    p += 46 + tamNome + tamExtra + tamComentario;
  }

  return {
    entradas,
    extrair(nome: string): Buffer {
      const e = entradas.find((x) => x.nome === nome);
      if (!e) {
        throw new Error(
          `entrada ausente no pacote: ${nome}\nO pacote tem: ${entradas.map((x) => x.nome).join(", ")}`,
        );
      }
      if (e.metodo !== 0 && e.metodo !== 8) {
        throw new Error(`metodo de compressao ${e.metodo} nao suportado em ${nome}.`);
      }

      const q = e.deslocamento;
      if (q + 30 > buf.length || buf.readUInt32LE(q) !== ASSINATURA_LOCAL) {
        throw new Error(`ZIP invalido: local header quebrado em ${nome} (offset ${q}).`);
      }
      // O local header repete nome e extra, e o tamanho do extra pode DIFERIR
      // do que o central directory diz -- por isso relemos daqui, e nao de la.
      const tamNome = buf.readUInt16LE(q + 26);
      const tamExtra = buf.readUInt16LE(q + 28);
      const inicio = q + 30 + tamNome + tamExtra;

      const corpo = buf.subarray(inicio, inicio + e.bytesComprimidos);
      const cru = e.metodo === 0 ? Buffer.from(corpo) : inflateRawSync(corpo);

      // O tamanho declarado e a unica soma de controle barata que temos aqui. Um
      // DEFLATE truncado descomprime sem erro e devolve um CSV com metade das
      // linhas -- que e o pior resultado possivel: empresas somem do ingestor em
      // silencio, e o que sobra parece completo.
      if (cru.length !== e.bytesDeclarados) {
        throw new Error(
          `${nome}: descomprimiu ${cru.length} bytes, mas o ZIP declara ${e.bytesDeclarados}.`,
        );
      }
      return cru;
    },
  };
}
