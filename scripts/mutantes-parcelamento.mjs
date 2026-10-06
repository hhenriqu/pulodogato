#!/usr/bin/env node
// Mutantes da serie de parcelas (lib/lancamento.ts) -- HMO-211.
//
// POR QUE ISTO EXISTE
// -------------------
// `test:parcelamento` passa com 23 assercoes verdes. Isso, sozinho, nao diz
// nada: um teste que nunca reprova e um teste que nao esta medindo o que a
// justificativa dele afirma. Cada mutante abaixo quebra UMA decisao de
// `serieDeParcelas`, e a suite tem que ficar vermelha em todos.
//
// OS QUATRO QUE A ISSUE NOMEOU, mais a decisao (A):
//
//   base_trocada        "1.000 em 10x" grava R$ 1.000 em vez de R$ 10.000
//   n_e_m_invertidos    "parcela 3 de 10" lido como "10 de 3"
//   off_by_one_*        uma parcela a mais / a menos no fim da serie
//   sobra_perdida       3 x 333,33 = 999,99, um centavo que linha nenhuma explica
//   grava_as_anteriores a opcao (B) entrando pela porta de tras
//
// Nenhum desses produz erro em runtime. Todos gravam dinheiro plausivel.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e feita em memoria e escrita numa SOMBRA da arvore -- um diretorio
// temporario onde tudo e symlink menos o arquivo mutado (ver
// `scripts/mutantes-em-bloco.mjs`). `lib/lancamento.ts` nao e tocado em momento
// nenhum; o pior caso de um processo morto no meio e uma sombra orfa em /tmp.
//
// O jeito usual -- mutar o arquivo, rodar, restaurar no `finally` -- deixa a
// fonte mutada no disco quando o processo morre no meio, e o placar seguinte
// vira ficcao. Pior neste repositorio: restaurar com `git checkout --` apaga
// edicao nao-commitada do mesmo arquivo, sem aviso.
//
// COMO RODAR
//   npm run mutantes:parcelamento

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const FONTE = "lib/lancamento.ts";
const SUITE = "test:parcelamento";

const original = readFileSync(FONTE, "utf8");

const MUTANTES = [
  {
    nome: "base_trocada",
    porque:
      'a pergunta da issue e ignorada: "parcela" passa a valer como "total" e uma compra de R$ 10.000 em 10x e gravada como R$ 1.000',
    de: 'base === "parcela" ? digitadoEmCentavos * m : digitadoEmCentavos;',
    para: 'base === "parcela" ? digitadoEmCentavos : digitadoEmCentavos * m;',
  },
  {
    nome: "base_ignorada",
    porque:
      "a base para de ser lida: todo valor digitado passa a ser o total, e quem responder 'o valor de cada parcela' tem a compra dividida por M",
    de: 'base === "parcela" ? digitadoEmCentavos * m : digitadoEmCentavos;',
    para: "digitadoEmCentavos;",
  },
  {
    nome: "n_e_m_invertidos",
    porque:
      '"parcela 3 de 10" e lido como "parcela 10 de 3": a serie nasce ao contrario',
    de: "  const { base, parcelaAtual: n, totalDeParcelas: m } = entrada;",
    para: "  const { base, parcelaAtual: m, totalDeParcelas: n } = entrada;",
  },
  {
    nome: "aceita_n_maior_que_m",
    porque:
      '"parcela 12 de 10" deixa de ser recusado, e o laco nao roda nenhuma volta -- zero parcelas gravadas e um toast de sucesso',
    de: "  if (n < 1 || n > m) return null;",
    para: "  if (n < 1) return null;",
  },
  {
    nome: "off_by_one_uma_a_mais",
    porque:
      "a serie ganha uma parcela alem de M: ela cai na fatura de um mes que ainda nao chegou, com valor plausivel",
    de: "  for (let numero = n; numero <= m; numero++) {",
    para: "  for (let numero = n; numero <= m + 1; numero++) {",
  },
  {
    nome: "off_by_one_uma_a_menos",
    porque:
      "a ultima parcela nao e gravada -- e e justamente ela que carrega a sobra da divisao, entao o centavo tambem desaparece",
    de: "  for (let numero = n; numero <= m; numero++) {",
    para: "  for (let numero = n; numero < m; numero++) {",
  },
  {
    nome: "grava_as_anteriores",
    porque:
      "a OPCAO (B) entrando pela porta de tras: a serie passa a incluir as parcelas 1..N-1, e o app afirma pagamentos que ninguem registrou",
    de: "  for (let numero = n; numero <= m; numero++) {",
    para: "  for (let numero = 1; numero <= m; numero++) {",
  },
  {
    nome: "sobra_perdida",
    porque:
      "a ultima parcela deixa de fechar o total: R$ 1.000 em 3x soma 999,99 e falta um centavo que nenhuma linha explica",
    de: "    totalEmCentavos - parcelaEmCentavos * (m - 1);",
    para: "    parcelaEmCentavos;",
  },
  {
    nome: "sobra_na_primeira",
    porque:
      "a sobra vai para a parcela N em vez da M -- com N > 1 a serie ainda fecha, mas o valor da parcela que a pessoa esta olhando fica errado",
    de: "      valor: (numero === m ? ultimaEmCentavos : parcelaEmCentavos) / 100,",
    para: "      valor: (numero === n ? ultimaEmCentavos : parcelaEmCentavos) / 100,",
  },
  {
    nome: "vencimento_nao_anda",
    porque:
      "todas as parcelas vencem no mesmo dia: as 10 caem na MESMA fatura e o mes fecha com dez vezes o valor",
    de: "    const vencimento = somaMeses(entrada.vencimentoDaParcelaAtual, numero - n);",
    para: "    const vencimento = somaMeses(entrada.vencimentoDaParcelaAtual, 0);",
  },
  {
    nome: "vencimento_conta_do_um",
    porque:
      "o deslocamento de mes conta da parcela 1 e nao da N: lancar 'parcela 3 de 10' joga a primeira linha dois meses para a frente",
    de: "    const vencimento = somaMeses(entrada.vencimentoDaParcelaAtual, numero - n);",
    para: "    const vencimento = somaMeses(entrada.vencimentoDaParcelaAtual, numero - 1);",
  },
  {
    nome: "dia_nao_grampeia",
    porque:
      "o dia deixa de ser grampeado no ultimo do mes: a parcela de 31/01 vai para 03/03 e a serie pula fevereiro",
    de: "  const diaDestino = Math.min(dia, ultimoDia);",
    para: "  const diaDestino = dia;",
  },
  {
    nome: "conta_em_ponto_flutuante",
    porque:
      "a aritmetica sai dos centavos inteiros: 1000/3 em float soma 999,99999999999989 e a fatura fecha num numero que nao e dinheiro",
    de: "  const digitadoEmCentavos = Math.round(valor * 100);",
    para: "  const digitadoEmCentavos = valor * 100;",
  },
  {
    nome: "serie_de_uma_parcela_passa",
    porque:
      'M = 1 deixa de ser recusado: "parcela 1 de 1" e uma compra avulsa com um rotulo a mais, e a tela passaria a rotular metade das compras',
    de: "  if (m < 2 || m > MAX_PARCELAS) return null;",
    para: "  if (m > MAX_PARCELAS) return null;",
  },
  {
    nome: "parcelamento_volta_para_toda_despesa",
    porque:
      "a checkbox volta a aparecer fora do cartao, onde a rota recusa -- a tela oferece um caminho que o servidor nao atende",
    // A ANCORA MUDOU DE TEXTO SEM MUDAR DE SENTIDO (HMO-319).
    //
    // Era `!editando && ehNoCartao`; a HMO-254 trocou por `natureza === "card"`
    // -- de proposito, e o comentario de 12 linhas acima da linha em
    // `lib/lancamento.ts` explica por que. O mutante continuava procurando o
    // texto antigo, nao achava, e o runner reportava
    // `NAO APLICOU: parcelamento_volta_para_toda_despesa`.
    //
    // Nao da para "consertar" isso tornando a busca frouxa: o que o mutante
    // precisa afirmar e que a condicao do cartao carrega peso, e isso se escreve
    // apagando a condicao -- qualquer que seja a forma dela hoje.
    de: '    parcelamento: !editando && natureza === "card",',
    para: "    parcelamento: !editando,",
  },
  {
    nome: "resumo_esconde_as_anteriores",
    porque:
      "o resumo deixa de dizer que as N-1 anteriores nao entram: a tela anuncia 10x e grava 8, e o unico aviso da decisao (A) desaparece",
    de: "  if (serie.parcelasAnteriores > 0) {",
    para: "  if (false) {",
  },
];

// O BLOCO: um diretorio, um processo, 16 voltas dentro (HMO-319).
//
// Antes eram 16 copias da arvore e 16 invocacoes de `tsc`. Agora a compilacao e
// em processo e todas as voltas dividem o AST ja parseado de tudo que nao e o
// arquivo mutado -- que e o unico reparseado por volta. As etapas (compilar,
// depois `node --test`) vem do proprio alvo `test:parcelamento` no package.json,
// em vez de serem repetidas a mao aqui: duas copias da mesma receita divergem, e
// a copia daqui mediria um pipeline que a suite nao usa mais.
const bloco = criarBlocoDeMutantes({ rotulo: "parcelamento", suites: [SUITE] });

const rodar = (nome, fonte) => bloco.rodar(nome, { [FONTE]: fonte }, SUITE);

let falhou = false;

try {
  // CONTROLE POSITIVO. Sem ele, um aparelho de mutacao quebrado faria TODO
  // mutante "morrer" e o placar sairia cheio sem que nenhuma assercao tivesse
  // medido nada -- ver `mutantes-e-controle-negativo`. Ele roda pelo MESMO
  // caminho que os mutantes, o que o torna a unica coisa capaz de pegar erro no
  // proprio runner.
  const controle = bloco.rodar("controle", {}, SUITE);
  if (!controle.verde) {
    console.error(
      `CONTROLE FALHOU: a fonte intacta nao passa na suite (${controle.como}) -> ${controle.saida}`
    );
    console.error("O aparelho de mutacao esta errado. O placar abaixo nao vale.");
    process.exitCode = 1;
    bloco.fechar();
    process.exit(1);
  }
  console.log("controle: a fonte intacta passa na suite  OK\n");

  let mortos = 0;
  let porTeste = 0;

  for (const m of MUTANTES) {
    // MUTANTE QUE NAO SE APLICA E O PIOR RESULTADO POSSIVEL: ele contaria como
    // "morreu" sem nunca ter existido.
    const ocorrencias = original.split(m.de).length - 1;
    if (ocorrencias === 0) {
      console.error(`NAO APLICOU: ${m.nome} -- o trecho procurado nao esta em ${FONTE}`);
      falhou = true;
      continue;
    }
    if (ocorrencias > 1) {
      console.error(
        `AMBIGUO: ${m.nome} -- o trecho aparece ${ocorrencias}x; a mutacao atingiria so a primeira`
      );
      falhou = true;
      continue;
    }

    const r = rodar(m.nome, original.replace(m.de, m.para));
    if (r.verde) {
      console.error(`SOBREVIVEU: ${m.nome}`);
      console.error(`            ${m.porque}`);
      // Sobreviver emitindo o MESMO byte nao e furo de assercao: e mutante
      // equivalente, e nenhuma assercao o mataria. A resposta e tirar o mutante
      // da lista, nao escrever teste -- oposta a do outro caso.
      if (!r.mudouASaida) {
        console.error(
          "            (a saida compilada e identica a da arvore limpa: mutante EQUIVALENTE, nao furo de teste)",
        );
      }
      falhou = true;
    } else {
      mortos++;
      if (r.como === "teste") porTeste++;
      console.log(`morreu:     ${m.nome}  (${r.como}: ${r.saida})`);
    }
  }

  console.log(`\n${mortos}/${MUTANTES.length} mutantes mortos (${porTeste} por assercao)`);

  // UM MUTANTE MORTO SO PELO `tsc` NAO PROVA ASSERCAO NENHUMA. Se todos
  // morressem assim, a suite poderia estar vazia e o placar sairia perfeito.
  if (mortos > 0 && porTeste === 0) {
    console.error(
      "\nNENHUM mutante foi morto por assercao -- todos cairam no compilador. A suite nao esta medindo nada."
    );
    falhou = true;
  }
} finally {
  bloco.fechar();
}

process.exitCode = falhou ? 1 : 0;
