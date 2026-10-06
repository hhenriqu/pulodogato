#!/usr/bin/env node
// Prova de mutacao de lib/renda-fixa.ts e lib/cdi.ts (HMO-192). NAO roda em CI:
// e ferramenta de quem esta escrevendo o teste. Cada entrada abaixo estraga UMA
// decisao do codigo; `npm run test:renda-fixa` tem que ficar VERMELHO em todas.
// Mutante que sobrevive e um trecho que nenhuma assercao distingue -- ou codigo
// morto.
//
//   npm run mutantes:renda-fixa
//
// TRES COISAS QUE ESTE RUNNER FAZ E O DE scripts/mutantes-investments.mjs NAO
// ---------------------------------------------------------------------------
//   1. CONTROLE POSITIVO. Roda a suite na arvore INTACTA antes de qualquer
//      mutacao. Sem ele, um erro no proprio runner (caminho errado, npm script
//      inexistente) deixa a suite vermelha em TODOS os mutantes e o relatorio
//      sai "16/16 mortos" sem ter medido nada;
//   2. CONTROLE NEGATIVO POR ANCORA UNICA. Uma ancora que aparece duas vezes no
//      arquivo faz `String.replace` estragar so a PRIMEIRA, e o mutante pode
//      cair num comentario ou numa funcao vizinha. Aqui a contagem e exigida: 1;
//   3. RESTAURA NO `exit`. Um timeout ou um Ctrl-C no meio do laco deixaria a
//      arvore MUTADA no disco -- e o commit seguinte levaria o mutante para a
//      main. O handler cobre tambem a falha inesperada do proprio runner.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ALVOS = ["lib/renda-fixa.ts", "lib/cdi.ts"];
const originais = new Map(ALVOS.map((a) => [a, readFileSync(a, "utf8")]));

function restaurar() {
  for (const [arquivo, conteudo] of originais) writeFileSync(arquivo, conteudo);
}
// Ver (3) no cabecalho: a arvore volta ao lugar mesmo se este processo morrer.
process.on("exit", restaurar);
process.on("SIGINT", () => process.exit(130));

/** [arquivo, nome, de, para] */
const mutantes = [
  // -----------------------------------------------------------------------
  // A formula do percentual do indice
  // -----------------------------------------------------------------------
  // "110% do CDI" multiplica a TAXA do dia; elevar o fator a 1,10 da numeros
  // quase iguais no primeiro dia e separa com os anos.
  [
    "lib/renda-fixa.ts",
    "percentual eleva o fator em vez de multiplicar a taxa",
    "fator *= 1 + (d.valor / 100) * (percentual / 100);",
    "fator *= Math.pow(1 + d.valor / 100, percentual / 100);",
  ],
  // O percentual ignorado faz todo CDB virar 100% do CDI -- e o defeito que a
  // issue inteira existe para corrigir.
  [
    "lib/renda-fixa.ts",
    "percentual do indice ignorado",
    "fator *= 1 + (d.valor / 100) * (percentual / 100);",
    "fator *= 1 + d.valor / 100;",
  ],
  // A taxa do SGS ja vem em % (0,050788 = 0,050788%). Tratar como fracao
  // multiplica o rendimento por 100.
  [
    "lib/renda-fixa.ts",
    "taxa do SGS lida como fracao e nao como porcento",
    "fator *= 1 + (d.valor / 100) * (percentual / 100);",
    "fator *= 1 + d.valor * (percentual / 100);",
  ],
  // 365 no denominador em vez de 252: a convencao brasileira e dia util.
  [
    "lib/renda-fixa.ts",
    "spread anual em dias corridos (365) e nao uteis (252)",
    "export const DIAS_UTEIS_NO_ANO = 252;",
    "export const DIAS_UTEIS_NO_ANO = 365;",
  ],
  // Spread somado ao indice e multiplicativo; somar os fatores em vez de
  // multiplicar perde o composto -- e some com o 1.
  [
    "lib/renda-fixa.ts",
    "spread soma em vez de multiplicar o fator do indice",
    "const fatorTotal = fatorIndice * fatorDoSpread(spread ?? 0, diasUteis);",
    "const fatorTotal = fatorIndice;",
  ],

  // -----------------------------------------------------------------------
  // O imposto de renda
  // -----------------------------------------------------------------------
  // As tres bordas da tabela regressiva, uma por mutante -- duas guardas
  // redundantes fazem os dois mutantes sobreviverem, e por isso cada `<=` e
  // mexido sozinho.
  [
    "lib/renda-fixa.ts",
    "borda de 180 dias vira 179 (22,5% para quem devia 20%)",
    "if (diasCorridos <= 180) return 22.5;",
    "if (diasCorridos < 180) return 22.5;",
  ],
  [
    "lib/renda-fixa.ts",
    "borda de 360 dias desloca a segunda faixa",
    "if (diasCorridos <= 360) return 20;",
    "if (diasCorridos < 360) return 20;",
  ],
  [
    "lib/renda-fixa.ts",
    "borda de 720 dias desloca a terceira faixa",
    "if (diasCorridos <= 720) return 17.5;",
    "if (diasCorridos < 720) return 17.5;",
  ],
  // A tabela invertida: 15% para quem acabou de aplicar.
  [
    "lib/renda-fixa.ts",
    "tabela do IR invertida (15% no curto prazo)",
    "if (diasCorridos <= 180) return 22.5;",
    "if (diasCorridos <= 180) return 15;",
  ],
  // O IR sobre o principal + rendimento em vez de so o rendimento.
  [
    "lib/renda-fixa.ts",
    "IR incide sobre o principal tambem",
    "const liquido = bruto - bruto * (aliquota / 100);",
    "const liquido = bruto - (e.principal + bruto) * (aliquota / 100);",
  ],
  // Nenhum IR: liquido igual ao bruto em TODO ativo. Mata se e so se a suite
  // tiver o caso TRIBUTADO com valor exato.
  [
    "lib/renda-fixa.ts",
    "nenhum IR descontado",
    "const liquido = bruto - bruto * (aliquota / 100);",
    "const liquido = bruto;",
  ],
  // A aliquota pelos dias UTEIS: 2,5 pontos a mais, sempre contra o usuario.
  [
    "lib/renda-fixa.ts",
    "aliquota pelos dias uteis e nao pelos corridos",
    "const aliquota = isento ? 0 : aliquotaDeIr(diasCorridos);",
    "const aliquota = isento ? 0 : aliquotaDeIr(diasNoPeriodo(e.serie || [], inicio, fim).length);",
  ],

  // -----------------------------------------------------------------------
  // A isencao -- o caso que a issue pediu explicitamente
  // -----------------------------------------------------------------------
  // A ancora vai ate o `];` de proposito: `"lci",\n  "lca",` aparece DUAS vezes
  // no arquivo -- em PRODUTOS e em PRODUTOS_ISENTOS_DE_IR, na mesma ordem -- e
  // `String.replace` pegaria a primeira, mutando a lista do CHECK em vez da
  // lista de isencao. O runner exige ancora unica justamente para isso.
  [
    "lib/renda-fixa.ts",
    "LCI e LCA fora da lista de isentos (cobra IR de quem e isento)",
    '  "lci",\n  "lca",\n  "cri",\n  "cra",\n  "debenture_incentivada",\n  "poupanca",\n];',
    '  "cri",\n  "cra",\n  "debenture_incentivada",\n  "poupanca",\n];',
  ],
  // `outro` e NULO como isentos: promete um liquido que o Leao vai cortar.
  [
    "lib/renda-fixa.ts",
    "produto desconhecido tratado como ISENTO",
    "return p !== null && PRODUTOS_ISENTOS_DE_IR.indexOf(p) >= 0;",
    "return p === null || PRODUTOS_ISENTOS_DE_IR.indexOf(p) >= 0;",
  ],
  // A isencao derivada do indexador, que e exatamente o que NAO da para fazer:
  // uma LCI e um CDB de 95% do CDI sao identicos fora do produto.
  [
    "lib/renda-fixa.ts",
    "isencao derivada do indexador em vez do produto",
    "const isento = isentoDeIr(produto);",
    'const isento = indexador === "poupanca";',
  ],

  // -----------------------------------------------------------------------
  // O calendario: o fim de semana e a borda do periodo
  // -----------------------------------------------------------------------
  // O dia da aplicacao rendendo: um dia util a mais em TODO ativo.
  [
    "lib/renda-fixa.ts",
    "o dia da aplicacao tambem rende",
    "return serie.filter((d) => d.data > inicioISO && d.data <= fimISO);",
    "return serie.filter((d) => d.data >= inicioISO && d.data <= fimISO);",
  ],
  // O fim exclusivo: perde o ultimo dia util.
  [
    "lib/renda-fixa.ts",
    "o ultimo dia do periodo nao rende",
    "return serie.filter((d) => d.data > inicioISO && d.data <= fimISO);",
    "return serie.filter((d) => d.data > inicioISO && d.data < fimISO);",
  ],
  // Sem recorte nenhum: a serie inteira capitaliza, inclusive o que e anterior
  // a aplicacao. E a janela alargada de lib/cdi.ts que torna isso visivel.
  [
    "lib/renda-fixa.ts",
    "periodo sem recorte: a serie inteira capitaliza",
    "return serie.filter((d) => d.data > inicioISO && d.data <= fimISO);",
    "return serie;",
  ],
  // O vencimento ignorado: um CDB vencido em 2024 acumula CDI para sempre.
  [
    "lib/renda-fixa.ts",
    "vencimento ignorado (papel vencido continua rendendo)",
    "const fim = venceu ? (e.ativo.maturity_date as string) : e.hoje;",
    "const fim = e.hoje;",
  ],

  // -----------------------------------------------------------------------
  // Serie vazia, prazo ausente: "nao sei" nao e "zero"
  // -----------------------------------------------------------------------
  // Serie vazia virando rendimento ZERO -- o defeito que a issue nomeia: a
  // pessoa conclui que o CDB dela parou de render.
  [
    "lib/renda-fixa.ts",
    "serie vazia tratada como rendimento zero",
    'return { ...base, motivo: "indisponivel" };',
    "return { ...base, bruto: 0, liquido: 0, porDia: 0 };",
  ],
  // Sem prazo, escolher uma aliquota: a 031 diz explicitamente que isso nao se
  // faz. (A primeira versao deste mutante acrescentava um `void 0;` depois do
  // return -- um no-op, que sobreviveu porque nao mutava nada. Mutante vivo
  // nem sempre e teste fraco: as vezes e mutante mal escrito.)
  [
    "lib/renda-fixa.ts",
    "sem prazo, assume que foi aplicado hoje e cobra 22,5%",
    'if (!inicio) return projecaoSemNumero(e, "sem_prazo");',
    'if (!inicio) return { ...projecaoSemNumero(e, "sem_prazo"), motivo: null, bruto: 0, liquido: 0, aliquota: 22.5 };',
  ],
  // A queda para a primeira compra desligada: pune quem cadastrou antes da 031.
  [
    "lib/renda-fixa.ts",
    "sem queda para a primeira compra",
    "const inicio = e.ativo.applied_date || e.primeiraCompra || null;",
    "const inicio = e.ativo.applied_date || null;",
  ],
  // A primeira compra GANHANDO do campo: a 031 guarda applied_date por um
  // motivo, e ele e a aliquota.
  [
    "lib/renda-fixa.ts",
    "primeira compra ganha de applied_date",
    "const inicio = e.ativo.applied_date || e.primeiraCompra || null;",
    "const inicio = e.primeiraCompra || e.ativo.applied_date || null;",
  ],
  // Provento e venda entrando no inicio do prazo: prazo inflado, aliquota menor
  // que a devida.
  [
    "lib/renda-fixa.ts",
    "venda e provento contam como inicio do prazo",
    'if (l.kind !== "buy") continue;',
    "",
  ],
  // IPCA projetado com a formula do CDI: um numero com cara de exato e sem
  // relacao com o extrato.
  [
    "lib/renda-fixa.ts",
    "IPCA e IGP-M projetados com a formula do CDI",
    'export const INDEXADORES_PROJETAVEIS: Indexador[] = ["cdi", "selic", "prefixado"];',
    "export const INDEXADORES_PROJETAVEIS: Indexador[] = INDEXADORES;",
  ],
  // O default de 100% virando zero: CDB sem percentual para de render.
  [
    "lib/renda-fixa.ts",
    "CDI sem percentual vale ZERO em vez de 100%",
    'indexador === "prefixado" ? 0 : numOuNulo(e.ativo.index_percentage) ?? 100;',
    'indexador === "prefixado" ? 0 : numOuNulo(e.ativo.index_percentage) ?? 0;',
  ],

  // -----------------------------------------------------------------------
  // A leitura da resposta do SGS (lib/renda-fixa.ts, pedaco puro)
  // -----------------------------------------------------------------------
  // Sem ordenar: a serie 4389 volta DECRESCENTE do mesmo endpoint, e o "ultimo
  // boletim" passa a ser o mais VELHO.
  [
    "lib/renda-fixa.ts",
    "serie do SGS nao e ordenada por data",
    "  return Object.keys(porData)\n    .sort()",
    "  return Object.keys(porData)",
  ],
  // Linha ilegivel virando ZERO: inventa dia util, que e o que vale R$ 39 num
  // prefixado.
  [
    "lib/renda-fixa.ts",
    "linha ilegivel do SGS virando valor zero",
    "    if (valor === null) continue;",
    "    if (valor === null) { porData[data] = 0; continue; }",
  ],
  // Data no formato da PTAX (MM-DD-YYYY) em vez do SGS (DD/MM/YYYY): devolve
  // dado de outro mes ou um 404 lido como feriado.
  [
    "lib/renda-fixa.ts",
    "data do SGS no formato da PTAX",
    "return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;",
    "return `${iso.slice(5, 7)}-${iso.slice(8, 10)}-${iso.slice(0, 4)}`;",
  ],
  // Mes e dia trocados: um "09/13" viraria "13 de setembro" num mes e "sem
  // boletim" no outro.
  [
    "lib/renda-fixa.ts",
    "dia e mes trocados na volta do SGS",
    "return `${s.slice(6, 10)}-${s.slice(3, 5)}-${s.slice(0, 2)}`;",
    "return `${s.slice(6, 10)}-${s.slice(0, 2)}-${s.slice(3, 5)}`;",
  ],
  // Resposta que nao e lista (o corpo do 404 do SGS) derrubando a rota.
  [
    "lib/renda-fixa.ts",
    "resposta que nao e lista nao e barrada",
    "  if (!Array.isArray(bruto)) return [];",
    "",
  ],

  // -----------------------------------------------------------------------
  // O campo digitado: ausente nao e ilegivel
  // -----------------------------------------------------------------------
  // "cento e dez" gravado como NULO, que a projecao le como 100% do CDI.
  [
    "lib/renda-fixa.ts",
    "campo ilegivel tratado como campo vazio",
    "  return Number.isFinite(n) ? n : NaN;\n}",
    "  return Number.isFinite(n) ? n : null;\n}",
  ],
  // O teto de digitacao: "11000" no lugar de "110".
  [
    "lib/renda-fixa.ts",
    "percentual sem teto de digitacao",
    "(!Number.isFinite(percentual) || percentual <= 0 || percentual > 1000)",
    "!Number.isFinite(percentual)",
  ],
  // Prefixado com percentual do indice: percentual de um indice que nao existe
  // na linha.
  [
    "lib/renda-fixa.ts",
    "prefixado aceita percentual do indice",
    'if (indexador === "prefixado" && percentual !== null) {',
    "if (false) {",
  ],
  // Percentual sem indexador: "110% de que?"
  [
    "lib/renda-fixa.ts",
    "percentual aceito sem indexador",
    "if (percentual !== null && indexador === null) {",
    "if (false) {",
  ],
  // Vencimento antes (ou igual) da aplicacao: prazo zero ou negativo.
  [
    "lib/renda-fixa.ts",
    "vencimento igual ou anterior a aplicacao e aceito",
    "if (aplicacao !== null && vencimento !== null && vencimento <= aplicacao) {",
    "if (false) {",
  ],

  // -----------------------------------------------------------------------
  // lib/cdi.ts -- a faixa e o mapa de series
  // -----------------------------------------------------------------------
  // A serie errada para o indexador: Selic lida da serie do CDI (ou vice-versa).
  [
    "lib/cdi.ts",
    "Selic aponta para a serie do CDI",
    "  selic: SERIE_SELIC_DIARIA,",
    "  selic: SERIE_CDI_DIARIO,",
  ],
  // IPCA com serie: a rota passaria a buscar boletim diario de um indice MENSAL.
  [
    "lib/cdi.ts",
    "IPCA ganha serie diaria no mapa",
    "export const SERIE_DO_INDEXADOR: Record<string, number> = {",
    "export const SERIE_DO_INDEXADOR: Record<string, number> = {\n  ipca: 433,",
  ],
  // O numero da serie do CDI trocado: 11 e a Selic, nao o CDI.
  [
    "lib/cdi.ts",
    "numero da serie do CDI trocado",
    "export const SERIE_CDI_DIARIO = 12;",
    "export const SERIE_CDI_DIARIO = 11;",
  ],
  // A janela de duas semanas encurtada para um dia: volta o 404 de sabado que o
  // cabecalho de lib/cdi.ts existe para explicar.
  [
    "lib/cdi.ts",
    "janela de um dia so (o 404 de sabado volta)",
    "export const JANELA_DE_DIAS = 14;",
    "export const JANELA_DE_DIAS = 0;",
  ],
  // `deslocarISO` andando para frente quando devia andar para tras.
  [
    "lib/cdi.ts",
    "deslocarISO anda para o lado errado",
    "return new Date(base + dias * 86400000).toISOString().slice(0, 10);",
    "return new Date(base - dias * 86400000).toISOString().slice(0, 10);",
  ],
];

// ---------------------------------------------------------------------------
// Controle positivo: a arvore intacta passa?
// ---------------------------------------------------------------------------
// Ver (1) no cabecalho. Sem este passo, um erro no runner sai como "todos
// mortos".
process.stdout.write("controle positivo (arvore intacta)... ");
try {
  execSync("npm run test:renda-fixa", { stdio: "pipe" });
  console.log("verde");
} catch (erro) {
  console.log("VERMELHO");
  console.error(
    "\nA suite reprova SEM mutante nenhum. Nao ha o que medir: conserte a suite\n" +
      "antes de rodar a prova de mutacao.\n"
  );
  console.error(String(erro.stdout || "").slice(-2000));
  process.exit(1);
}

let sobreviventes = 0;

for (const [arquivo, nome, de, para] of mutantes) {
  const original = originais.get(arquivo);
  const ocorrencias = original.split(de).length - 1;

  // Ver (2) no cabecalho: ancora ausente e mutante desatualizado; ancora
  // repetida estraga so a primeira ocorrencia e pode nem ser a linha visada.
  if (ocorrencias !== 1) {
    console.log(
      `??  ${nome} -- a ancora aparece ${ocorrencias}x em ${arquivo} (esperado 1)`
    );
    sobreviventes++;
    continue;
  }

  writeFileSync(arquivo, original.replace(de, para));
  let vermelho = false;
  try {
    execSync("npm run test:renda-fixa", { stdio: "pipe" });
  } catch {
    vermelho = true;
  }
  writeFileSync(arquivo, original);

  console.log(`${vermelho ? "OK  " : "VIVO"} ${nome}`);
  if (!vermelho) sobreviventes++;
}

restaurar();
console.log(
  `\n${mutantes.length - sobreviventes}/${mutantes.length} mutantes mortos`
);
process.exit(sobreviventes === 0 ? 0 : 1);
