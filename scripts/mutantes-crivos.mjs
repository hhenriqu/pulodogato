#!/usr/bin/env node
// =====================================================
// MUTANTES DOS CRIVOS DE FUNDAMENTO (HMO-195)
// =====================================================
// Uma suite de 50 asercoes que nunca viu vermelho nao e evidencia de nada. Este
// script estraga um arquivo por vez -- `lib/crivos.ts` ou o componente que os
// imprime --, roda `npm run test:crivos` e EXIGE que a suite reprove.
//
// Aqui isso vale mais que o normal porque TODO defeito desta entrega e mudo:
//
//   * esquecer a conversao de unidade nao levanta erro -- desenha uma carteira em
//     que nenhuma empresa bate criterio nenhum, e 0,26% ao lado de "acima de 15%"
//     parece uma empresa ruim, nao um bug;
//   * tratar `NULL` como reprovado nao levanta erro -- e tratar como zero APROVA
//     a empresa sobre a qual nao se sabe nada, num crivo de divida;
//   * fixar o ano do balanco nao levanta erro -- faz metade das empresas
//     desaparecer da lista em silencio.
//
// Mutante que sobrevive aponta uma regra que o codigo afirma e o teste nao
// verifica. Mesmo desenho de scripts/mutantes-fundamento-cvm.mjs.
//
// Roda com: node scripts/mutantes-crivos.mjs
// =====================================================

import { execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const LIB = "lib/crivos.ts";
const TELA = "components/investments/CrivosDeFundamento.tsx";

const MUTANTES = [
  // -------------------------------------------------------------------------
  // Armadilha 1: a unidade
  // -------------------------------------------------------------------------
  {
    nome: "esquece a conversao: compara a razao crua com o limite em porcentagem",
    alvo: LIB,
    de: `  return unidade === "percentual" ? razao * 100 : razao;`,
    para: `  return razao;`,
  },
  {
    nome: "converte TUDO para porcentagem, inclusive o multiplicador",
    alvo: LIB,
    de: `  return unidade === "percentual" ? razao * 100 : razao;`,
    para: `  return razao * 100;`,
  },
  {
    nome: "divide o limite em vez de multiplicar o valor",
    alvo: LIB,
    de: `  const valor = daViewParaUnidade(razao, crivo.unidade);
  const atingido =
    crivo.direcao === "acima" ? valor > limite : valor < limite;`,
    para: `  const valor = razao;
  const atingido =
    crivo.direcao === "acima" ? valor > limite / 100 : valor < limite / 100;`,
  },

  // -------------------------------------------------------------------------
  // Armadilha 2: o exercicio
  // -------------------------------------------------------------------------
  {
    nome: "fica com a PRIMEIRA linha de cada ticker em vez da mais recente",
    alvo: LIB,
    de: `    const anoNovo = numeroOuNulo(linha.ano_exercicio) ?? -Infinity;`,
    para: `    if (atual !== undefined) continue;
    const anoNovo = numeroOuNulo(linha.ano_exercicio) ?? -Infinity;`,
  },
  {
    nome: "pega o exercicio mais ANTIGO de cada empresa",
    alvo: LIB,
    de: `    if (anoNovo > anoAtual) {`,
    para: `    if (anoNovo < anoAtual) {`,
  },
  {
    nome: "nao agrupa por ticker: devolve uma linha por exercicio importado",
    alvo: LIB,
    de: `    const atual = porTicker.get(chave);`,
    para: `    const atual = porTicker.get(\`\${chave}-\${linha.ano_exercicio}\`) ??
      (porTicker.set(\`\${chave}-\${linha.ano_exercicio}\`, linha), undefined);
    if (atual !== undefined) continue;`,
  },
  {
    nome: "casa o ticker com sensibilidade a caixa",
    alvo: LIB,
    de: `      porTicker.get(String(ativo.symbol ?? "").trim().toUpperCase()),`,
    para: `      porTicker.get(String(ativo.symbol ?? "")),`,
  },

  // -------------------------------------------------------------------------
  // Armadilha 3: NULL
  // -------------------------------------------------------------------------
  {
    nome: "NULL vira reprovado em vez de 'sem dado'",
    alvo: LIB,
    de: `    return { ...base, valor: null, estado: "sem_dado" };`,
    para: `    return { ...base, valor: null, estado: "nao_atingido" };`,
  },
  {
    nome: "NULL vira zero -- o que APROVA no crivo de divida",
    alvo: LIB,
    de: `  const razao = linha ? numeroOuNulo(linha[crivo.campo]) : null;
  if (razao === null) {`,
    para: `  const razao = linha ? numeroOuNulo(linha[crivo.campo]) ?? 0 : 0;
  if (false) {`,
  },
  {
    nome: "numeroOuNulo usa Number() direto: string vazia vira zero",
    alvo: LIB,
    de: `export function numeroOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;`,
    para: `export function numeroOuNulo(valor: unknown): number | null {
  const bruto = Number(valor);
  if (Number.isFinite(bruto)) return bruto;
  if (valor === null || valor === undefined) return null;`,
  },
  {
    nome: "o rotulo de 'sem dado' passa a ser o de reprovado",
    alvo: LIB,
    de: `  sem_dado: "Sem dado no balanço",`,
    para: `  sem_dado: "Não atingido",`,
  },
  {
    nome: "valor ausente e impresso como zero em vez de travessao",
    alvo: LIB,
    de: `  if (valor === null) return "—";`,
    para: `  if (valor === null) valor = 0;`,
  },

  // -------------------------------------------------------------------------
  // A comparacao e a direcao
  // -------------------------------------------------------------------------
  {
    nome: "todo crivo compara 'acima de', inclusive o de alavancagem",
    alvo: LIB,
    de: `    crivo.direcao === "acima" ? valor > limite : valor < limite;`,
    para: `    valor > limite;`,
  },
  {
    nome: "a comparacao deixa de ser estrita",
    alvo: LIB,
    de: `    crivo.direcao === "acima" ? valor > limite : valor < limite;`,
    para: `    crivo.direcao === "acima" ? valor >= limite : valor <= limite;`,
  },

  // -------------------------------------------------------------------------
  // O limite do usuario
  // -------------------------------------------------------------------------
  {
    nome: "o limite do usuario e ignorado: vale sempre o de fabrica",
    alvo: LIB,
    de: `  const efetivos = lerLimites({ [CHAVE_DE_CRIVOS]: { limites } });`,
    para: `  const efetivos = limitesPadrao();`,
  },
  {
    nome: "lerLimites devolve so o que esta salvo, sem completar pelo catalogo",
    alvo: LIB,
    de: `  const saida = limitesPadrao();
  if (!salvos) return saida;`,
    para: `  const saida: LimitesDosCrivos = {};
  if (!salvos) return limitesPadrao();`,
  },
  {
    nome: "mesclarLimites escreve so o bloco de crivos e apaga o resto do jsonb",
    alvo: LIB,
    de: `  const raiz = objeto(preferencesAtuais) ?? {};
  const bloco = objeto(raiz[CHAVE_DE_CRIVOS]) ?? {};
  return {
    ...raiz,
    [CHAVE_DE_CRIVOS]: { ...bloco, limites: { ...limites } },
  };`,
    para: `  return { [CHAVE_DE_CRIVOS]: { limites: { ...limites } } };`,
  },
  {
    nome: "validarLimites completa a chave ausente em vez de recusar",
    alvo: LIB,
    de: `    if (!(crivo.id in limites)) {
      return { ok: false, erro: \`Falta o limite de \${crivo.rotulo}\` };
    }`,
    para: `    if (!(crivo.id in limites)) {
      saida[crivo.id] = crivo.limitePadrao;
      continue;
    }`,
  },
  {
    nome: "validarLimites aceita qualquer numero, sem faixa",
    alvo: LIB,
    de: `    if (!limiteAceitavel(crivo, limites[crivo.id])) {`,
    para: `    if (numeroOuNulo(limites[crivo.id]) === null) {`,
  },
  {
    nome: "validarLimites grava a string como veio, em vez do numero",
    alvo: LIB,
    de: `    saida[crivo.id] = numeroOuNulo(limites[crivo.id]) as number;
  }
  return { ok: true, valor: saida };`,
    para: `    saida[crivo.id] = limites[crivo.id] as number;
  }
  return { ok: true, valor: saida };`,
  },
  {
    nome: "campo apagado salta para o limite de fabrica no meio da digitacao",
    alvo: LIB,
    de: `  const base = lerLimites({ [CHAVE_DE_CRIVOS]: { limites: salvos } });
  const saida: LimitesDosCrivos = { ...base };`,
    para: `  const saida: LimitesDosCrivos = limitesPadrao();`,
  },
  {
    nome: "limitesEfetivos aceita limite fora da faixa que a rota vai recusar",
    alvo: LIB,
    de: `    if (digitado !== null && limiteAceitavel(crivo, digitado)) {`,
    para: `    if (digitado !== null) {`,
  },
  {
    nome: "o campo abre com virgula, que o input numerico recusa",
    alvo: LIB,
    de: `export function formatarLimiteParaCampo(limite: number): string {
  return String(limite);
}`,
    para: `export function formatarLimiteParaCampo(limite: number): string {
  return limite.toLocaleString("pt-BR");
}`,
  },
  {
    nome: "o campo nao aceita a virgula do teclado do celular",
    alvo: LIB,
    de: `  const limpo = texto.trim().replace(",", ".");`,
    para: `  const limpo = texto.trim();`,
  },

  // -------------------------------------------------------------------------
  // O estado explicito de quem fica fora dos crivos
  // -------------------------------------------------------------------------
  {
    nome: "FII cai na lista de criterios e recebe tres selos",
    alvo: LIB,
    de: `  const porTipo = TIPO_FORA_DOS_CRIVOS[ativo.type];
  if (porTipo) return semCriterios(porTipo);`,
    para: ``,
  },
  {
    nome: "a fonte indisponivel e anunciada ao FII, sugerindo que um dia responde",
    alvo: LIB,
    de: `  const porTipo = TIPO_FORA_DOS_CRIVOS[ativo.type];
  if (porTipo) return semCriterios(porTipo);
  if (fonteIndisponivel) return semCriterios("fonte_indisponivel");`,
    para: `  if (fonteIndisponivel) return semCriterios("fonte_indisponivel");
  const porTipo = TIPO_FORA_DOS_CRIVOS[ativo.type];
  if (porTipo) return semCriterios(porTipo);`,
  },
  {
    nome: "acao sem balanco importado recebe o texto do FII",
    alvo: LIB,
    de: `  sem_fundamento:
    "O balanço deste ativo ainda não foi importado da CVM. Nenhum critério foi avaliado — isto não é reprovação.",`,
    para: `  sem_fundamento: EXPLICACAO_FORA_DOS_CRIVOS_FII,`,
    extra: [
      {
        de: `export const EXPLICACAO_FORA_DOS_CRIVOS: Record<MotivoForaDosCrivos, string> = {`,
        para: `const EXPLICACAO_FORA_DOS_CRIVOS_FII =
  "Fundo imobiliário não publica balanço de companhia na CVM.";
export const EXPLICACAO_FORA_DOS_CRIVOS: Record<MotivoForaDosCrivos, string> = {`,
      },
    ],
  },
  {
    nome: "a view ausente devolve card sem criterio E sem frase",
    alvo: LIB,
    de: `    explicacao: EXPLICACAO_FORA_DOS_CRIVOS[motivo],`,
    para: `    explicacao: null,`,
  },

  // -------------------------------------------------------------------------
  // A marcacao
  // -------------------------------------------------------------------------
  {
    nome: "a tela imprime a lista de criterios mesmo quando ha frase",
    alvo: TELA,
    de: `      {ativo.explicacao !== null ? (`,
    para: `      {false ? (`,
  },
  {
    nome: "a tela nao imprime a frase de quem fica fora dos crivos",
    alvo: TELA,
    de: `      {ativo.explicacao !== null ? (`,
    para: `      {null !== null ? (`,
  },
  {
    nome: "a tela esconde o selo do estado",
    alvo: TELA,
    de: `        <Selo estado={avaliacao.estado} />`,
    para: ``,
  },
  {
    nome: "a tela nao diz de qual balanco o numero saiu",
    alvo: TELA,
    de: `            balanço de {ativo.anoExercicio ?? "—"}, data-base{" "}
            {formatarDataBase(ativo.dataBase)}`,
    para: `            balanço mais recente`,
  },
  {
    nome: "a tela nao declara a fonte de cada indicador",
    alvo: TELA,
    de: `        <p className="text-xs text-muted-foreground">{avaliacao.fonte}</p>`,
    para: ``,
  },
  {
    nome: "a tela nao imprime o criterio do usuario ao lado do indicador",
    alvo: TELA,
    de: `            seu critério: {avaliacao.criterio}`,
    para: `            critério de mercado`,
  },
  {
    nome: "a tela acrescenta uma nota unica de conveniencia",
    alvo: TELA,
    de: `        <CardDescription>`,
    para: `        <CardDescription>
          Score da carteira: 3 de 3 — bom momento para comprar.{" "}`,
  },
  {
    nome: "a tela deixa de declarar o crivo que esta entrega nao fecha",
    alvo: TELA,
    de: `          {CRIVOS_PENDENTES.map((pendente) => (`,
    para: `          {[].map((pendente: { id: string; rotulo: string; motivo: string }) => (`,
  },
  {
    nome: "a carteira vazia nao diz nada",
    alvo: TELA,
    de: `            Cadastre um ativo para ver os critérios dele.`,
    para: ``,
  },
  {
    nome: "a lista passa a ser avaliada com o limite salvo, ignorando o digitado",
    alvo: TELA,
    de: `  const limites = limitesEfetivos(textos, dados.limites);`,
    para: `  const limites = limitesEfetivos({}, dados.limites);`,
  },
  {
    nome: "o aviso de nao-salvo compara com o jsonb cru e aparece sempre",
    alvo: TELA,
    de: `  const salvos = limitesEfetivos({}, dados.limites);`,
    para: `  const salvos = dados.limites;`,
  },
];

// ---------------------------------------------------------------------------
// O laco
// ---------------------------------------------------------------------------

const backupDe = (alvo) => `${RAIZ}${alvo}.mutantes.bak`;
const caminhoDe = (alvo) => `${RAIZ}${alvo}`;

const ALVOS = [...new Set(MUTANTES.map((m) => m.alvo))];

for (const alvo of ALVOS) {
  if (!existsSync(caminhoDe(alvo))) {
    console.error(`ERRO: ${alvo} nao existe.`);
    process.exit(1);
  }
  if (existsSync(backupDe(alvo))) {
    console.error(
      `ERRO: ${alvo}.mutantes.bak existe. Uma rodada anterior morreu no meio;\n` +
        `confira o arquivo antes de continuar e restaure o backup a mao.`
    );
    process.exit(1);
  }
}

const original = Object.fromEntries(
  ALVOS.map((alvo) => [alvo, readFileSync(caminhoDe(alvo), "utf8")])
);
for (const alvo of ALVOS) copyFileSync(caminhoDe(alvo), backupDe(alvo));

function restaurar() {
  for (const alvo of ALVOS) {
    copyFileSync(backupDe(alvo), caminhoDe(alvo));
    unlinkSync(backupDe(alvo));
  }
}

/**
 * Restaura o alvo e SO ENTAO sai.
 *
 * `process.exit()` dentro do `try` pula o `finally`: a rodada abortaria deixando
 * o fonte mutado no disco e o placar dos mutantes seguintes viraria ficcao.
 */
function abortar(mensagem) {
  restaurar();
  console.error(`\nERRO: ${mensagem}`);
  process.exit(1);
}

let mortos = 0;
const sobreviventes = [];

try {
  for (const mutante of MUTANTES) {
    const caminho = caminhoDe(mutante.alvo);
    const trocas = [
      { de: mutante.de, para: mutante.para },
      ...(mutante.extra ?? []),
    ];

    let mutado = original[mutante.alvo];
    for (const { de, para } of trocas) {
      if (!mutado.includes(de)) {
        // Mutante que nao encontra o alvo nao aplica nada, e ai a suite passa --
        // o que se leria como "sobreviveu". Um controle negativo que nasce falso
        // e pior que nenhum.
        abortar(
          `o trecho do mutante "${mutante.nome}" nao existe mais em ${mutante.alvo}:\n  ${
            de.split("\n")[0]
          }`
        );
      }
      mutado = mutado.replace(de, para);
    }
    if (mutado === original[mutante.alvo]) {
      abortar(`o mutante "${mutante.nome}" nao mudou nada.`);
    }
    writeFileSync(caminho, mutado);

    let reprovou = false;
    let motivo = "";
    try {
      execSync("npm run test:crivos", { stdio: "pipe", encoding: "utf8", cwd: RAIZ });
    } catch (erro) {
      reprovou = true;
      const saida = `${erro.stdout ?? ""}${erro.stderr ?? ""}`;
      // O tsc reprovando conta como morto -- mutante que nao compila nao chega em
      // producao. Mas vale distinguir: erro de tipo nao diz que a SUITE pegou a
      // regra.
      motivo = /error TS\d+/.test(saida) ? "tsc" : "asercao";
    }

    // Devolve o arquivo antes do proximo mutante: dois mutantes empilhados
    // medem uma combinacao que ninguem escreveria.
    writeFileSync(caminho, original[mutante.alvo]);

    if (reprovou) {
      mortos++;
      console.log(`MORTO ${mutante.nome}  (${motivo})`);
    } else {
      console.log(`VIVO  ${mutante.nome}`);
      sobreviventes.push(mutante.nome);
    }
  }
} finally {
  restaurar();
}

console.log(`\n${mortos}/${MUTANTES.length} mortos.`);

if (sobreviventes.length > 0) {
  console.log("\nSOBREVIVENTES:");
  for (const nome of sobreviventes) console.log(`  - ${nome}`);
  process.exit(1);
}
