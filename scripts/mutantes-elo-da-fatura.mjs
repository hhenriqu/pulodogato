#!/usr/bin/env node
// Mutantes do elo explicito da fatura (lib/elo-da-fatura.ts) -- HMO-307.
//
// POR QUE ISTO EXISTE
// -------------------
// A HMO-305 entregou `lib/elo-da-fatura.ts` e `npm run test:elo-da-fatura` com
// 23 casos, cinco deles cobrando a AUSENCIA do rotulo -- e nenhum runner de
// mutante. "A suite cobra" e "a suite reprova quando o codigo erra" sao duas
// afirmacoes diferentes, e so a segunda vale.
//
// Aqui o erro caro e ASSIMETRICO, e e isso que organiza a lista abaixo. O
// rotulo que NAO acende deixa o mes como esta hoje (R$ 1.600,00, com as duas
// linhas a vista, conferivel). O rotulo que acende na linha ERRADA poe na tela
// um botao que, clicado, grava a chave canonica e faz `sintetizarFaturasAbertas`
// esconder uma divida verdadeira. Por isso cada mutante abaixo e uma troca de
// UMA linha que COMPILA e produz uma tela plausivel.
//
// OS DOIS QUE VALEM SER LIDOS ANTES DE MEXER NO ARQUIVO
// ------------------------------------------------------
// `mes_do_vencimento` e a armadilha que a medicao da HMO-305 achou de verdade. A
// suspeita passa a carregar o mes do VENCIMENTO da previsao em vez do
// `invoice_month` da fatura -- e preserva o formato 'AAAA-MM-01', entao o cenario
// comum (cartao que fecha e vence no mesmo mes) fica identico. O estrago aparece
// no cartao que fecha dia 28 e vence dia 5: a chave gravada e
// `fatura:2026-04-01:...`, que NENHUMA fatura casa. A escrita acontece, a
// de-duplicacao nao, e a tela diz "pronto". Quem o mata e UM caso so -- o da
// fatura de marco que vence em abril.
//
// `citacao_por_substring` SOBREVIVIA a suite da HMO-305, e o caso novo que o mata
// esta explicado abaixo (ver o comentario do proprio mutante): o exemplo da issue
// -- um cartao "Nu" casando com "Numerario da viagem" -- e barrado por OUTRA
// guarda, a do nome curto. Medir a palavra inteira exigia um nome de cartao com
// tres letras ou mais que fosse prefixo de outra palavra, e "Inter" dentro de
// "Internet" e esse caso, com as duas contas existindo na vida real.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e feita em memoria e escrita dentro da sombra do bloco, em diretorio
// temporario; `lib/elo-da-fatura.ts` nao e tocado em momento nenhum. O jeito
// usual -- mutar o arquivo, rodar, restaurar no `finally` -- deixa a fonte mutada
// no disco quando o processo morre no meio (SIGTERM do timeout nao roda gancho
// nenhum), e o placar seguinte vira ficcao.
//
// POR QUE ESTE RUNNER NAO COPIA A ARVORE
// ---------------------------------------
// A issue pedia `lib/elo-da-fatura.ts` no `DEPENDENCIAS` do mutador "se ele
// copiar a arvore" -- a nota que `scripts/mutantes-telas-de-movimentacao.mjs`
// carrega, onde uma dependencia faltando faz TODO mutante deixar de compilar e o
// placar virar 100% sem medir nada. Este runner usa `criarBlocoDeMutantes`
// (HMO-319), que nao tem lista de dependencias: a compilacao le a arvore de
// verdade e troca em memoria so o arquivo mutado. Nao ha segunda copia do grafo
// de modulos para envelhecer em silencio, e as etapas vem do proprio
// `test:elo-da-fatura` do package.json em vez de repetidas a mao aqui.
//
// (O `DEPENDENCIAS` daquele runner JA tem `lib/elo-da-fatura.ts`, posto pela
// propria HMO-305 -- nada a fazer la.)
//
// COMO RODAR
//   npm run mutantes:elo-da-fatura

import { readFileSync } from "node:fs";
import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const FONTE = "lib/elo-da-fatura.ts";

const original = readFileSync(FONTE, "utf8");

const MUTANTES = [
  // -------------------------------------------------------------------------
  // A CITACAO DO NOME DO CARTAO -- o unico elo que existe entre as duas linhas
  // -------------------------------------------------------------------------
  {
    nome: "citacao_por_substring",
    porque:
      "O MUTANTE QUE A HMO-305 NAO MEDIA. `descricaoCitaOCartao` passa a casar por substring: um cartao Inter casa com 'Internet de marco', o rotulo aponta a fatura errada, e o clique de confirmacao esconde R$ 160 de divida verdadeira. O exemplo da issue ('Nu' dentro de 'Numerario') NAO mede isto -- quem o barra e a guarda do nome curto, e o mutante dela esta logo abaixo",
    de: `  const daDescricao: { [palavra: string]: true } = {};
  for (const p of palavras(descricao)) daDescricao[p] = true;

  return doCartao.every((p) => daDescricao[p] === true);`,
    para: `  const daDescricao = palavras(descricao).join(" ");

  return doCartao.every((p) => daDescricao.includes(p));`,
  },
  {
    nome: "nome_curto_entra",
    porque:
      "a guarda do nome que nao identifica nada sai: um cartao chamado 'C' ou '7' casa com qualquer descricao que tenha a letra solta, e TODA linha do mes ganha o botao de esconder divida. E esta guarda -- nao a da palavra inteira -- que barra o 'Nu' de 'Numerario' do exemplo da issue",
    de: "  if (!doCartao.some((p) => p.length >= 3)) return false;",
    para: "  if (false) return false;",
  },

  // -------------------------------------------------------------------------
  // AS PENEIRAS DE `suspeitasDeFaturaRepetida`
  // -------------------------------------------------------------------------
  // A guarda `doCartao.length === 0` NAO esta na lista, e nao e esquecimento: a
  // guarda do nome curto acima ja recusa a lista vazia (`[].some(...)` e falso),
  // entao o mutante dela e SEMANTICAMENTE IDENTICO a versao boa -- ele
  // sobreviveria, e sobreviver estaria certo. Duas guardas redundantes fazem os
  // dois mutantes sobreviverem, e um sobrevivente que esta certo ensina a nao ler
  // o placar.
  {
    nome: "ja_ligada_continua_suspeita",
    porque:
      "a peneira do `ehFatura(notes)` sai e o rotulo NUNCA deixa a tela: a linha que a pessoa ja ligou continua oferecendo 'e a fatura deste cartao', e o segundo clique regrava a chave que ja estava la -- o app fica dizendo que ha algo a resolver num mes resolvido",
    de: "    if (ehFatura(linha.notes)) continue;\n",
    para: "",
  },
  {
    nome: "grupo_entra",
    porque:
      "conta de GRUPO passa a ser candidata. O valor que a tela mostra ali ja e a MINHA fracao do rateio, entao o rotulo e errado sobre um numero que ja e outro -- e o clique poe a chave canonica da fatura do meu cartao numa despesa compartilhada",
    de: "    if (linha.group_id != null) continue;\n",
    para: "",
  },
  {
    nome: "receita_entra",
    porque:
      "RECEITA passa a ser candidata: um estorno do Nubank -- que ENTRA dinheiro -- ganha botao de 'esconder a divida', e a de-duplicacao casaria a fatura aberta com uma linha de sinal oposto",
    de: '    if (linha.direction === "income") continue;\n',
    para: "",
  },
  {
    nome: "fatura_fechada_vira_candidata",
    porque:
      "o `!gravada` do laco das faturas abertas sai, e a fatura FECHADA (que e linha de agenda de verdade, com a mesma chave) passa a ser alvo do elo. Ligar uma previsao digitada a ela cria DUAS linhas com a mesma chave e nao ha fatura sintetizada para suprimir: o mes continua dobrado, com a tela dizendo 'pronto'",
    de: "    if (gravada) continue;\n",
    para: "",
  },
  {
    nome: "ambiguidade_escolhe_a_primeira",
    porque:
      "com DUAS faturas candidatas o app escolhe uma no lugar da pessoa, justamente no caso em que ela e a unica que sabe qual e qual -- e o clique seguinte esconde a divida do cartao errado",
    de: "    if (candidatas.length !== 1) continue;",
    para: "    if (candidatas.length === 0) continue;",
  },
  {
    nome: "mes_do_vencimento",
    porque:
      "A ARMADILHA QUE A MEDICAO DA HMO-305 ACHOU DE VERDADE: a suspeita carrega o mes do VENCIMENTO da previsao em vez do `invoice_month` da fatura, com o formato 'AAAA-MM-01' preservado. No cartao que fecha e vence no mesmo mes nada muda; no que fecha dia 28 e vence dia 5, a chave gravada e `fatura:2026-04-01:...`, que NENHUMA fatura casa -- a escrita acontece, a de-duplicacao nao, e a tela diz 'pronto'",
    de: `    suspeitas.set(id, {
      accountId: f.accountId,
      mes: f.mes,`,
    para: `    suspeitas.set(id, {
      accountId: f.accountId,
      mes: \`\${mes}-01\`,`,
  },

  // -------------------------------------------------------------------------
  // O DESFAZER -- e a linha que NAO se desfaz por aqui
  // -------------------------------------------------------------------------
  {
    nome: "desfaz_a_fatura_fechada",
    porque:
      "`eloDesfazivel` deixa de comparar o `accountId` da linha com o da chave, e o desfazer passa a aceitar a FATURA FECHADA. A chave dela e o que torna o fechamento idempotente: apagada, um segundo clique em 'fechar fatura' cria uma SEGUNDA conta a pagar do mesmo mes",
    de: "  if (daLinha === daChave.accountId) return null;",
    para: "  if (false) return null;",
  },
  {
    nome: "desfaz_sem_a_conta_da_linha",
    porque:
      "sem `accountIdDaLinha` nao da para distinguir a previsao ligada da fatura fechada, e o mutante oferece o botao de qualquer jeito: a tela poe na mao da pessoa uma acao que o DELETE da rota -- que aplica o MESMO criterio -- vai recusar",
    de: "  if (!daLinha) return null;",
    para: "  if (false) return null;",
  },

  // -------------------------------------------------------------------------
  // A ESCRITA -- a chave tem de ser EXATA, e o desfazer tem de ser NULL
  // -------------------------------------------------------------------------
  {
    nome: "chave_com_sufixo",
    porque:
      "o sufixo inocente: `RE_CHAVE_FATURA` e ancorada nas duas pontas, entao ' (confirmado)' faz a chave deixar de ser chave. A rota grava, a tela diz 'pronto', e `chavesPersistidas` nao reconhece nada -- o mes volta a somar a divida duas vezes sem erro nenhum",
    de: "  return chaveFatura(mes, accountId);",
    para: '  return `${chaveFatura(mes, accountId)} (confirmado)`;',
  },
  {
    nome: "desfazer_grava_vazio",
    porque:
      "desfazer passa a gravar string vazia em vez de NULL. `faturaDaChave` responde `null` para os dois, entao a de-duplicacao se comporta igual -- mas `notes: ''` e um texto que a pessoa nunca escreveu, e aparece na tela de edicao como um campo preenchido com nada",
    de: "export const NOTES_SEM_ELO = null;",
    para: 'export const NOTES_SEM_ELO = "";',
  },
];

// O BLOCO: um diretorio, um processo, a fonte e os mutantes dentro (HMO-319).
// As etapas vem do proprio alvo `test:elo-da-fatura` no package.json -- uma copia
// da receita escrita a mao aqui divergiria do alvo de verdade sem nada reclamar,
// e o placar afirmaria cobertura sobre etapas que este runner nao roda.
const SUITE_DO_BLOCO = "test:elo-da-fatura";
const bloco = criarBlocoDeMutantes({
  rotulo: "elo-da-fatura",
  suites: [SUITE_DO_BLOCO],
});

/** Uma volta do bloco. `null` de fonte e a arvore intacta (controle positivo). */
const voltaDoBloco = (nome, fonte) =>
  bloco.rodar(nome, fonte === null ? {} : { [FONTE]: fonte }, SUITE_DO_BLOCO);

let falhou = false;

try {
  // CONTROLE POSITIVO. Sem ele, "todos morreram" pode significar so que o build
  // quebrou: um oraculo ja vermelho mata todo mutante de graca e o placar sai
  // cheio sem que uma assercao tenha medido nada.
  const controle = voltaDoBloco("controle", original);
  if (!controle.verde) {
    console.error(
      `CONTROLE POSITIVO FALHOU: a fonte intacta nao passa na suite (${controle.como}) -> ${controle.saida}`
    );
    console.error("O placar abaixo nao vale, e por isso nao sai nenhum.");
    bloco.fechar();
    process.exit(1);
  }
  console.log("controle positivo: a fonte intacta passa na suite  OK\n");

  let mortos = 0;
  let porTeste = 0;

  for (const m of MUTANTES) {
    // MUTANTE QUE NAO SE APLICA E O PIOR RESULTADO POSSIVEL: ele contaria como
    // "morreu" sem nunca ter existido. E a ambiguidade importa tanto quanto a
    // ausencia -- `candidatas.length !== 1` aparece tambem no COMENTARIO que
    // explica a peneira, e um `replace` cego mutaria a prosa e deixaria o codigo
    // intacto.
    const ocorrencias = original.split(m.de).length - 1;
    if (ocorrencias === 0) {
      console.error(
        `NAO APLICOU: ${m.nome} -- o trecho procurado nao esta em ${FONTE}`
      );
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

    const r = voltaDoBloco(m.nome, original.replace(m.de, m.para));
    if (r.verde) {
      console.error(`SOBREVIVEU: ${m.nome}`);
      console.error(`            ${m.porque}`);
      // Sobreviver emitindo o MESMO byte nao e furo de assercao: e mutante
      // equivalente, e nenhuma assercao do mundo o mataria.
      if (r.mudouASaida === false) {
        console.error(
          "            (a saida compilada e identica a da arvore limpa: mutante EQUIVALENTE, nao furo de teste)"
        );
      }
      falhou = true;
    } else {
      mortos++;
      if (r.como === "teste") porTeste++;
      console.log(`morreu:     ${m.nome}  (${r.como}: ${r.saida})`);
    }
  }

  console.log(
    `\n${mortos}/${MUTANTES.length} mutantes mortos (${porTeste} por assercao)`
  );

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
