// CONTROLE NEGATIVO do DETALHE do painel de papel -- HMO-300 (9/10 do plano da
// HMO-279), medido por `npm run test:papel-de-pao`.
//
// O MUTANTE QUE DECIDE ESTA ISSUE
// -------------------------------
// Listar as linhas ANTES da divisao da parte do grupo. Ele poe R$ 3.000 numa
// lista debaixo de um total que tem R$ 1.500 dela -- e nao quebra nada: a
// resposta e 200, o numero grande continua certo, o chevron abre, as linhas
// aparecem com nome e data, e nada no tsc, no lint ou no `next build` ve
// diferenca. O que a tela passa a fazer e pior do que mostrar um numero
// errado: ela EXPLICA o numero certo com valores que nao somam nele.
//
// E ele passa por QUALQUER assercao que so conte linhas. So a soma o mata --
// e so num fixture que TENHA linha de grupo. Num mes sem grupo
// `parteDoMembro` devolve o valor cheio e o mutante e indistinguivel do
// codigo correto. Por isso o caso com grupo da suite nao e opcional, e por
// isso este runner existe: a vacuidade de um fixture sem grupo nao apareceria
// de nenhuma outra forma.
//
// POR QUE ESTE RUNNER E SEPARADO DO `mutantes-mes-do-painel.mjs`
// --------------------------------------------------------------
// Aquele mede o `?month=`; este mede a lista. Sao dois assuntos, e juntar os
// dois faria o placar de um esconder o do outro -- 11/11 e 11/11 somam 22/22, e
// um sobrevivente no meio de 22 nomes se le pior. Nao e job novo: e um step do
// mesmo job, que o custo aqui e o NUMERO DE JOBS.
//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-328)
// --------------------------------------------------------
// Este runner MUTAVA A ARVORE RASTREADA: guardava o texto original em memoria,
// escrevia o mutante num dos 3 arquivos de producao da lista,
// chamava `npm run` ali mesmo e restaurava depois. Dois defeitos nisso, e o
// segundo e o que doia:
//
//   1. cada volta recompilava o programa INTEIRO, mesmo mudando UM arquivo. Sao
//      21 mutantes, e cada um roda AS DUAS suites (test:papel-de-pao, test:papel-na-tela),
//      e era um dos passos mais caros do job de verificacao;
//
//   2. o mutante ficava GRAVADO no arquivo de producao quando o processo morria
//      no meio. O gancho de restauracao e `process.on("exit")`, que NAO roda em
//      SIGTERM -- e SIGTERM e o que um timeout manda. Pior: `execSync` bloqueia
//      a thread do JS, entao nem um handler de SIGTERM resolve; o processo
//      termina a volta em curso e aplica A SEGUINTE. Aconteceu nesta arvore duas
//      vezes (`PainelDePapel.tsx` na HMO-296, `DivisaoDoGrupo.tsx` herdado
//      mutado pela HMO-263), e nas duas o `git status` mostrava UM arquivo
//      modificado -- a cara de trabalho em andamento.
//
// Agora as voltas dividem um processo e um cache de AST
// (`criarBlocoDeMutantes`, HMO-319): so o arquivo mutado e reparseado, e a
// mutacao vai para uma SOMBRA em diretorio temporario. A arvore rastreada e o
// `.tmp-*` do repositorio nao sao tocados em momento nenhum, entao o pior caso
// de um processo morto e um diretorio orfao em /tmp.
//
// As etapas de cada suite saem do proprio `scripts[...]` do package.json -- o
// comando que o CI roda --, e nao de uma receita repetida a mao aqui.
//
// A lista de mutantes abaixo NAO foi reescrita: ela veio byte a byte do arquivo
// anterior, pelo `scripts/converte-mutantes-em-bloco.mjs`.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const LIB = "lib/papel-de-pao.ts";
const ROTA = "app/api/papel-de-pao/painel/route.ts";
const PAINEL = "components/papel-de-pao/PainelDePapel.tsx";

const mutantes = [
  // ---------------------------------------------------------------------------
  // A FUNCAO PURA -- a invariante `soma(detalhe) === total`
  // ---------------------------------------------------------------------------
  {
    // O MUTANTE DA ISSUE. A lista mostra o valor CHEIO do grupo; o total
    // continua sendo a minha parte. Morre so contra a soma, e so no fixture
    // com grupo.
    nome: "o detalhe lista a linha ANTES de dividir a parte do grupo",
    arquivo: LIB,
    // O QUARTO ARGUMENTO ENTROU NA HMO-305 -- HMO-333. `linhaDoDetalhe` ganhou
    // `suspeitas` (o mapa da fatura repetida), e a ancora de tres argumentos
    // deixou de casar. Ele vai tambem no `para`: um mutante que CHAMASSE com
    // tres argumentos morreria no tsc, e morrer no tsc nao diz que a suite
    // pegou a regra da divisao.
    de: "    detalhe.push(linhaDoDetalhe(linha, valor, ctx.meuUserId, suspeitas));",
    para:
      "    detalhe.push(\n" +
      "      linhaDoDetalhe(\n" +
      "        linha,\n" +
      "        Math.abs(Number(linha.amount) || 0),\n" +
      "        ctx.meuUserId,\n" +
      "        suspeitas\n" +
      "      )\n" +
      "    );",
  },
  {
    // A MESMA FAMILIA, pelo outro lado: a lista perde a fatura aberta
    // sintetizada. O total continua com ela -- a soma das linhas abertas fica
    // MENOR que o numero de cima, e o cartao se desmente sozinho.
    nome: "o detalhe descarta a fatura aberta sintetizada",
    arquivo: LIB,
    // A MESMA DERIVA DO `suspeitas` do mutante acima (HMO-333), nos dois lados.
    de: "    detalhe.push(linhaDoDetalhe(linha, valor, ctx.meuUserId, suspeitas));",
    para:
      "    if (linha.id != null)\n" +
      "      detalhe.push(linhaDoDetalhe(linha, valor, ctx.meuUserId, suspeitas));",
  },
  {
    // O DETALHE MONTADO POR FORA DA PENEIRA -- a segunda leitura que a issue
    // proibe, na forma mais plausivel: um `filter` que esqueceu o STATUS.
    // 'skipped' e 'cancelled' voltam para a lista e nao voltam para o total.
    nome: "o detalhe vem de um segundo filtro, que esquece skipped/cancelled",
    arquivo: LIB,
    // REESCRITO CONTRA A FORMA NOVA DO RETORNO -- HMO-333, e sao TRES derivas
    // de uma vez:
    //
    //   1. `somarPerna` deixou de devolver o `NumeroDoPapel` cru. Desde a
    //      HMO-303 ela devolve `{ numero, fora }` -- a contagem lateral da
    //      transferencia --, entao o `detalhe` mutado tem de ir DENTRO do
    //      `numero`, e o `fora` tem de continuar saindo igual: o mutante e
    //      sobre a lista, e mexer na contagem lateral de arrasto o faria
    //      morrer por outro motivo;
    //   2. `parteDoMembro(amount, group_id, membrosAtivosPorGrupo)` nao existe
    //      mais. A HMO-303 trocou a CONTAGEM de membros pelo PESO configurado:
    //      hoje e `parteConfiguradaDoMembro(amount, group_id, pesosPorGrupo,
    //      meuUserId)`. O segundo filtro tem de repetir a chamada ATUAL, senao
    //      ele nao compila;
    //   3. `linhaDoDetalhe` pede o quarto argumento (`suspeitas`, HMO-305).
    //
    // As tres sao a mesma exigencia: o mutante tem de COMPILAR para que o
    // veredito signifique algo. Um `para` que nao compila morre no tsc, e
    // morrer no tsc nao prova que a SUITE pegou a regra que a issue cobra --
    // seria um 21/21 sobre um mutante que nunca foi medido pela assercao.
    //
    // `linhas`, `ctx`, `aceita` e `suspeitas` sao todos parametros de
    // `somarPerna`, e `dentroDaJanela` e `parteConfiguradaDoMembro` sao
    // modulo/import: todos em escopo neste ponto.
    //
    // E O DEFEITO MEDIDO CONTINUA O MESMO: o filtro repete a janela e o
    // `aceita`, e ESQUECE o `STATUS_FORA_DO_PREVISTO`. 'skipped' e 'cancelled'
    // voltam para a lista e nao voltam para o total.
    //
    // CONFERIDO POR QUAL ASSERCAO O MATA, e nao so pelo veredito. O segundo
    // filtro difere do original em DUAS coisas -- o status esquecido e o
    // `detalhe.sort` perdido --, e a lista ja tem um mutante de ordem ("a
    // lista nao e ordenada por vencimento"). Se este morresse pela assercao de
    // ORDEM, seria uma copia daquele e o status ficaria sem medida. Nao e o
    // caso: ele reprova em "o detalhe FECHA com o total", nos tres casos (o
    // fixture inteiro de marco, o mes com a fatura sintetizada, e o sem
    // `meuUserId`) -- a invariante `soma(detalhe) === total`, que e exatamente
    // a regra que o status esquecido quebra.
    de: `  return {
    numero: { total: centavos(total), quantidade, detalhe },
    fora: { total: centavos(fora.total), quantidade: fora.quantidade },
  };`,
    para:
      "  return {\n" +
      "    numero: {\n" +
      "      total: centavos(total),\n" +
      "      quantidade,\n" +
      "      detalhe: linhas\n" +
      "        .filter((l) => dentroDaJanela(l.due_date, ctx.janela) && aceita(l))\n" +
      "        .map((l) =>\n" +
      "          linhaDoDetalhe(\n" +
      "            l,\n" +
      "            Math.abs(\n" +
      "              Number(\n" +
      "                parteConfiguradaDoMembro(\n" +
      "                  l.amount,\n" +
      "                  l.group_id,\n" +
      "                  ctx.pesosPorGrupo,\n" +
      "                  ctx.meuUserId\n" +
      "                )\n" +
      "              ) || 0\n" +
      "            ),\n" +
      "            ctx.meuUserId,\n" +
      "            suspeitas\n" +
      "          )\n" +
      "        ),\n" +
      "    },\n" +
      "    fora: { total: centavos(fora.total), quantidade: fora.quantidade },\n" +
      "  };",
  },
  {
    // INDISPONIVEL COM LISTA. `total: null` nao e zero, e uma lista debaixo de
    // "indisponivel" explicaria um numero que a tela acabou de dizer que nao
    // sabe. O total nao muda; so a lista aparece onde nao devia.
    //
    // O MUTANTE TEM DE SER NO CAMINHO DA DIRECAO AUSENTE, e nao no
    // `quantidade === 0` de `somarPerna`: la o `detalhe` esta vazio por
    // construcao (nada foi empurrado), entao `{ ...semLinha(), detalhe }` e um
    // mutante EQUIVALENTE -- ele sobrevive por estar certo, nao por falta de
    // assercao. Aqui ha linhas de verdade para vazar.
    nome: "o painel calado pela direcao ausente ainda devolve a lista",
    arquivo: LIB,
    de: "      salario_previsto: semLinha(),",
    para:
      "      salario_previsto: {\n" +
      "        ...semLinha(),\n" +
      "        detalhe: naJanela.map((l) => linhaDoDetalhe(l, 0, ctx.meuUserId)),\n" +
      "      },",
  },
  {
    // A ORDEM. A fatura sintetizada e concatenada no FIM da lista crua; sem
    // ordenar ela aparece depois da conta do dia 28 por acidente de montagem.
    // A soma nao muda -- so a leitura da pessoa.
    nome: "a lista nao e ordenada por vencimento",
    arquivo: LIB,
    de: "  detalhe.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));",
    para: "",
  },
  {
    // `semLinha` DE VOLTA A CONSTANTE: os tres numeros passam a dividir o
    // MESMO array. Hoje ninguem escreve nele, entao o mutante so morre pela
    // assercao de identidade -- que existe por isso.
    nome: "os tres numeros vazios dividem a MESMA lista",
    arquivo: LIB,
    de: `const semLinha = (): NumeroDoPapel => ({
  total: null,
  quantidade: 0,
  detalhe: [],
});`,
    para: `const VAZIO: NumeroDoPapel = { total: null, quantidade: 0, detalhe: [] };
const semLinha = (): NumeroDoPapel => VAZIO;`,
  },

  // ---------------------------------------------------------------------------
  // `posso_editar` -- o campo que a 10/10 consome
  //
  // OS TRES MUTAM O CAMPO, E NAO A VARIAVEL `posso` -- HMO-333.
  // A ancora dos tres era a expressao solta
  // `      gravada && meuUserId != null && linha.user_id === meuUserId,`, que
  // na epoca era o valor de `posso_editar` E DE MAIS NADA. A HMO-305 extraiu
  // aquela expressao para `const posso`, com outra indentacao e terminando em
  // `;`, e pendurou nela TRES campos: `posso_editar`, `fatura_suspeita` e
  // `elo_da_fatura`.
  //
  // Entao havia duas formas de consertar, e elas NAO medem a mesma coisa:
  //
  //   * mutar a `const posso` -- mexe nos tres campos de uma vez. E um
  //     mutante mais FACIL de matar (tres sintomas observaveis em vez de um),
  //     e ele mede "o criterio de quem pode agir esta errado", que e mais
  //     largo do que o que estas tres entradas foram escritas para medir;
  //   * mutar `posso_editar: posso,` -- muda EXATAMENTE o que a ancora antiga
  //     mudava: um campo. O `posso` continua certo para os outros dois, e o
  //     unico sintoma e o que cada nome aqui descreve.
  //
  // Escolhido o segundo, e o que decide nao e gosto: `test-papel-de-pao.mjs`
  // tem 16 assercoes sobre `posso_editar` e ZERO sobre `fatura_suspeita` ou
  // `elo_da_fatura`. Um mutante na `const posso` morreria -- mas morreria
  // PELAS assercoes de `posso_editar`, as mesmas que os tres daqui ja usam.
  // Ele nao mediria nada a mais e pareceria medir tres campos: e a forma de
  // mutante que afirma mais do que mede. O mutante no campo diz a verdade
  // sobre o seu proprio alcance.
  //
  // E FICA UM BURACO NOMEADO, que esta issue nao fecha: o `posso` tambem
  // porteia `fatura_suspeita` e `elo_da_fatura`, e NADA mede esse porteiro.
  // `mutantes-elo-da-fatura.mjs` nao cobre isto -- ele muta
  // `lib/elo-da-fatura.ts`, ou seja o CRITERIO da suspeita e do desfazer, nao
  // a condicao que decide se o campo sai preenchido. Trocar o `posso` desses
  // dois campos por `gravada` abriria o elo na linha de outro membro do grupo,
  // onde o `UPDATE` volta 200 sem alterar nada -- e as duas suites deste
  // runner passariam. Ver HMO-336, que entra pela ordem certa: a assercao dos
  // dois campos primeiro, o mutante da `const posso` depois.
  // ---------------------------------------------------------------------------
  {
    // O DEFEITO CARO: todo mundo pode editar tudo. A linha de grupo do OUTRO
    // membro ganha botao, a RLS recusa, e `UPDATE` recusado pela RLS volta 200
    // sem alterar nada -- o app diz "pronto" e a linha fica.
    nome: "`posso_editar` nao olha de quem e a linha",
    arquivo: LIB,
    de: "    posso_editar: posso,",
    para: "    posso_editar: gravada,",
  },
  {
    // A FATURA SINTETIZADA GANHA ACAO. Ela nao tem id de banco: a baixa
    // responde 404, que para quem clicou se le como "o app nao conseguiu".
    nome: "a linha nao gravada tambem ganha acao",
    arquivo: LIB,
    de: "    posso_editar: posso,",
    para: "    posso_editar: meuUserId != null && linha.user_id === meuUserId,",
  },
  {
    // FALHA ABERTO em vez de fechado: sem `meuUserId` toda linha vira
    // editavel. E o estado de uma rota que esqueceu de passar o campo -- e o
    // sintoma seria botao em linha alheia.
    nome: "sem `meuUserId`, toda linha gravada vira editavel",
    arquivo: LIB,
    de: "    posso_editar: posso,",
    para:
      "    posso_editar:\n" +
      "      gravada && (meuUserId == null || linha.user_id === meuUserId),",
  },
  {
    // `gravada` DEIXA DE OLHAR O ID: a fatura sintetizada passa a parecer
    // linha de banco, e com ela o caminho de volta para o cartao some (o
    // `fatura` sai do mesmo criterio).
    nome: "toda linha e considerada gravada",
    arquivo: LIB,
    de: "  const gravada = id !== null;",
    para: "  const gravada = true;",
  },
  {
    // O ROTULO DE GRUPO FIXO EM FALSO: o aluguel pela metade aparece sem
    // explicacao, e se le como erro de digitacao.
    nome: "nenhuma linha vem rotulada como de grupo",
    arquivo: LIB,
    de: "    de_grupo: linha.group_id != null,",
    para: "    de_grupo: false,",
  },

  // ---------------------------------------------------------------------------
  // A ROTA -- as tres colunas e o `meuUserId`
  // ---------------------------------------------------------------------------
  {
    // A COLUNA DO NOME. A lista abre com todas as linhas "sem descricao" --
    // os valores certos, e nada dizendo o que cada um e.
    nome: "a rota nao le `description`",
    arquivo: ROTA,
    de: '"id, due_date, description, amount',
    para: '"id, due_date, amount',
  },
  {
    // A COLUNA DO ID. Toda linha vira nao-gravada: a lista abre sem acao
    // nenhuma, e a 10/10 nasce sem botao, com a lib intacta.
    nome: "a rota nao le `id`",
    arquivo: ROTA,
    de: '"id, due_date, description',
    para: '"due_date, description',
  },
  {
    // A COLUNA DO DONO. `posso_editar` cai para false em tudo -- o mesmo
    // sintoma do de cima, por outro caminho, e e por isso que sao dois
    // mutantes e nao um.
    nome: "a rota nao le `user_id`",
    arquivo: ROTA,
    de: "group_id, user_id, notes",
    para: "group_id, notes",
  },
  {
    // O CALL SITE. A rota le a coluna e nao diz quem e a pessoa: as duas
    // pontas compilam, e `posso_editar` fica false em tudo.
    nome: "a rota nao passa o `meuUserId` adiante",
    arquivo: ROTA,
    de: "      meuUserId: user.id,",
    para: "",
  },
  {
    // A SEGUNDA LEITURA, na forma que a issue proibe por nome: uma consulta
    // nova para montar a lista. Aqui ela e so acrescentada (nem chega a ser
    // usada), e e exatamente isso que o caso "NENHUMA CONSULTA NOVA" cobra --
    // uma quarta `.from(` no arquivo ja e o defeito, porque a proxima linha
    // escrita vai consumi-la.
    nome: "a rota acrescenta uma quarta consulta",
    arquivo: ROTA,
    de: "    // A CONTA, inteira, numa chamada.",
    para:
      '    await supabase.from("scheduled_transactions").select("id");\n\n' +
      "    // A CONTA, inteira, numa chamada.",
  },

  // ---------------------------------------------------------------------------
  // A TELA -- o que so a assercao textual pega (o comportamento e medido em
  // navegador, por `npm run test:papel-na-tela`)
  // ---------------------------------------------------------------------------
  {
    // A TELA REFAZ A CONTA. A lista deixa de ser a que a rota aceitou e passa
    // a ser a que a tela peneirou -- a segunda definicao do numero, debaixo
    // dele.
    nome: "a tela filtra a lista que chegou",
    arquivo: PAINEL,
    de: "  const linhas = numero?.detalhe ?? [];",
    para: "  const linhas = (numero?.detalhe ?? []).filter((l) => l.gravada);",
  },
  {
    // O CHEVRON NASCE ABERTO. A issue pede fechado por padrao: o modo simples
    // abriria com duas listas de contas na cara de quem escolheu ver menos.
    nome: "o chevron nasce aberto",
    arquivo: PAINEL,
    de: "  const [aberto, setAberto] = useState(false);",
    para: "  const [aberto, setAberto] = useState(true);",
  },
  {
    // A SETA VIRA ENFEITE: sem `aria-expanded`, quem usa leitor de tela nao
    // sabe que ha o que abrir. A tela fica identica para quem enxerga.
    nome: "o botao do chevron perde o `aria-expanded`",
    arquivo: PAINEL,
    de: "              aria-expanded={aberto}",
    para: "",
  },
  {
    // A SETA APARECE NO CARTAO VAZIO. Clicar abre uma lista sem linha nenhuma,
    // que se le como app quebrado.
    nome: "a seta aparece mesmo sem linha para abrir",
    arquivo: PAINEL,
    de: "    fase === \"pronto\" && numero != null && numero.total !== null && linhas.length > 0;",
    para: '    fase === "pronto" && numero != null && numero.total !== null;',
  },
  {
    // O LINK DA FATURA PERDE O MES. O destino plausivel e errado: abre o mes
    // corrente do cartao certo, e a tela de destino parece perfeita.
    nome: "o link da fatura esquece o mes",
    arquivo: PAINEL,
    de: "caminhoDoCartaoNoMes(linha.fatura.accountId, linha.fatura.mes)",
    para: "caminhoDoCartaoNoMes(linha.fatura.accountId, null)",
  },
];

const SUITES = ["test:papel-de-pao","test:papel-na-tela"];

const bloco = criarBlocoDeMutantes({ rotulo: "detalhe-do-painel", suites: SUITES });

// A sombra vive em diretorio temporario, e a arvore rastreada nunca e mutada --
// era esse o modo de falha deste runner. O handler de sinal existe so para que
// nem o diretorio orfao sobre: `finally` nao roda em SIGTERM, mas
// `process.exit` dispara o `exit` abaixo.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// O texto de cada arquivo que algum mutante toca. Lido da arvore de verdade, que
// e o original por construcao: nada mais aqui escreve nela.
const original = new Map();
for (const arquivo of new Set(mutantes.map((m) => m.arquivo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

// CONTROLE POSITIVO, primeiro e obrigatorio: as DUAS suites tem de passar com a
// arvore INTACTA, e pelo MESMO `rodar` que os mutantes usam -- por isso ele pega
// erro no proprio aparelho. Sem ele, uma sombra mal montada reprova TODO mutante
// e o placar fecha "N/N mortos" sobre zero assercoes executadas.
for (const suite of SUITES) {
  const controle = bloco.rodar("controle", {}, suite);
  if (!controle.verde) {
    console.error(`ABORTADO: a arvore INTACTA reprova em ${suite} (${controle.como}).`);
    console.error(`  ${controle.saida}`);
    console.error("O placar nao valeria: todo mutante 'morreria' sem ter sido medido.");
    process.exit(1);
  }
}
console.log(`controle positivo: a arvore intacta passa em ${SUITES.join(" e ")}\n`);

let sobreviventes = 0;

for (const m of mutantes) {
  const antes = original.get(m.arquivo);

  // AS TRES TRAVAS DE ANCORA. As duas das pontas ja existiam neste runner; a do
  // meio e a que a conversao acrescenta (ver OCORRENCIA UNICA, no conversor).
  const ocorrencias = antes.split(m.de).length - 1;
  if (ocorrencias === 0) {
    console.error(`SOBREVIVEU (ancora nao casou) :: ${m.nome}`);
    console.error(`  o texto buscado nao existe em ${m.arquivo}: ${m.de}`);
    sobreviventes++;
    continue;
  }
  if (ocorrencias > 1) {
    console.error(`SOBREVIVEU (ancora ambigua) :: ${m.nome}`);
    console.error(`  o texto aparece ${ocorrencias}x em ${m.arquivo} -- o replace muta so a 1a`);
    sobreviventes++;
    continue;
  }
  const depois = antes.replace(m.de, m.para);
  if (depois === antes) {
    console.error(`SOBREVIVEU (replace nao mudou nada) :: ${m.nome}`);
    sobreviventes++;
    continue;
  }

  // TODAS as suites, parando na primeira que mata -- e a ordem e a do arquivo
  // anterior, que importa: a suite barata vem primeiro justamente para que o
  // mutante que ela mata nao pague a de navegador.
  let r;
  for (const suite of SUITES) {
    r = bloco.rodar(m.nome, { [m.arquivo]: depois }, suite);
    if (!r.verde) break;
  }

  if (r.verde) {
    console.error(`SOBREVIVEU :: ${m.nome}`);
    // A NOTA DE MUTANTE EQUIVALENTE NAO E IMPRIMIDA AQUI, e isto e deliberado.
    // `criarBlocoDeMutantes` guarda UMA saida de controle por BLOCO, preenchida
    // na primeira volta sem sobrescritas -- nao uma por suite. Com duas suites, o
    // `mudouASaida` do mutante compara o que ESTA suite emitiu com a linha de
    // base da OUTRA, e as duas emitem conjuntos diferentes de arquivos: a
    // resposta seria "mudou" sempre, inclusive para um mutante de fato
    // equivalente. Imprimir a nota a partir dela seria um rotulo que nao mede o
    // que diz; omiti-la perde uma dica e nao afirma nada falso.
    //
    // Quem quiser a nota de volta: a linha de base precisa ser por alvo dentro do
    // bloco. Nao foi mexido aqui porque `mutantes-em-bloco.mjs` e compartilhado
    // por outros runners e a nota nao muda veredito nenhum.
    sobreviventes++;
  } else {
    // Morrer no tsc tambem e morrer -- mutante que nao compila nao chega em
    // producao --, mas a distincao importa: um erro de tipo nao diz que a SUITE
    // pegou a regra.
    console.log(`morreu     :: ${m.nome}  (${r.como === "tsc" ? "tsc" : "asercao"})`);
  }
}

console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mortos`);
process.exit(sobreviventes === 0 ? 0 : 1);
