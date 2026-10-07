// CONTROLE NEGATIVO da metade do PAINEL em `npm run test:papel-na-tela` -- a
// leitura do rotulo que a HMO-294 encurtou, mais o PASSO DE MES da HMO-295.
//
// POR QUE ESTE RUNNER EXISTE
// --------------------------
// A HMO-294 trocou uma `string` literal por outra mais curta --
// `rotulo="Salário Previsto"` virou `rotulo="Salário"` -- e NADA no repositorio
// ve essa troca sozinho: o tsc e o lint nao olham conteudo de literal, o
// `next build` compila as duas igual, e `npm run test:papel-de-pao` mede a
// ARITMETICA do painel, que nao mudou. E a mesma familia de defeito que ja deu
// "40 blocos verdes com a classificacao invertida" neste repositorio: campo de
// ROTULO atravessa suite de numero sem tocar em nada.
//
// Entao o que precisa de prova nao e "a suite passa" -- ela passava com o texto
// velho --, e sim que ela SABE REPROVAR as tres formas do defeito:
//
//   1. o rotulo volta a ser o texto longo (o defeito literal da issue);
//   2. o rotulo vai para o cartao ERRADO (os dois cartoes compilam igual);
//   3. a ANCORA da sonda (`data-rotulo`) muda de nome -- e esta e a que
//      importa para o runner, porque sem ela a sonda leria uma lista VAZIA de
//      rotulos, e "Salário Previsto nao aparece" e verdade numa lista vazia.
//      O caso que mata este mutante e o controle positivo da montagem, nao a
//      assercao do rotulo.
//
// A SUITE E DE NAVEGADOR, e cada volta custa ~5s. Sao dezessete voltas (uma de
// controle positivo e dezesseis de mutante), e por isso o runner e separado do
// `mutantes-menu-papel.mjs`: o do menu e puro e roda em menos de 1s por volta.
// Pela mesma razao as funcoes PURAS nao sao medidas aqui -- os mutantes da rota
// e da janela do mes vivem em `scripts/mutantes-mes-do-painel.mjs`, e os da
// aritmetica do terceiro cartao em `scripts/mutantes-sobra-ou-falta.mjs`. Os
// dois medem a suite pura, que roda em segundos.
//
// A HMO-296 acrescentou o TERCEIRO CARTAO, e com ele cinco mutantes de tela no
// fim da lista. O criterio para um mutante morar aqui e o mesmo de sempre: ele
// tem de ser invisivel sem navegador -- um cartao que sai da arvore, uma linha
// de conferencia que nao renderiza, duas parcelas trocadas entre si.
//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-328)
// --------------------------------------------------------
// Este runner MUTAVA A ARVORE RASTREADA: guardava o texto original em memoria,
// escrevia o mutante em `components/papel-de-pao/PainelDePapel.tsx`,
// chamava `npm run` ali mesmo e restaurava depois. Dois defeitos nisso, e o
// segundo e o que doia:
//
//   1. cada volta recompilava o programa INTEIRO, mesmo mudando UM arquivo. Sao
//      16 mutantes em `test:papel-na-tela`,
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

const PAINEL = "components/papel-de-pao/PainelDePapel.tsx";

const mutantes = [
  {
    // O DEFEITO LITERAL DA ISSUE. Ele morre so porque a assercao tem as DUAS
    // metades: "Salário" PRESENTE sobrevive a este mutante, porque "Salário" e
    // substring de "Salário Previsto".
    nome: "o rotulo volta a ser `Salário Previsto`",
    arquivo: PAINEL,
    de: 'rotulo="Salário"',
    para: 'rotulo="Salário Previsto"',
  },
  {
    // O ROTULO NO CARTAO ERRADO. Os dois `NumeroGrande` tem a mesma assinatura,
    // entao trocar os rotulos de lugar compila, renderiza e passa por qualquer
    // assercao que so procurasse as duas palavras na tela. Morre na comparacao
    // ORDENADA de `data-rotulo`.
    nome: "os dois rotulos trocam de cartao",
    arquivo: PAINEL,
    de: 'rotulo="Salário"',
    para: 'rotulo="Total de contas"',
  },
  {
    // A ANCORA DA SONDA. Sem `data-rotulo` no DOM, a lista de rotulos vem
    // vazia -- e uma lista vazia satisfaz "Salário Previsto nao aparece". Quem
    // mata este mutante e o caso "o painel montou de verdade", que exige os
    // TRES cartoes de producao antes de qualquer assercao sobre texto.
    nome: "o `data-rotulo` muda de nome (a sonda passa a ler o vazio)",
    arquivo: PAINEL,
    de: "data-rotulo={rotulo}",
    para: "data-rotulo-do-cartao={rotulo}",
  },

  // ===========================================================================
  // O PASSO DE MES -- HMO-295 (5/6)
  // ===========================================================================
  // Os mutantes da ROTA e da funcao pura estao em
  // `scripts/mutantes-mes-do-painel.mjs`, que mede a suite pura e roda em
  // segundos. Aqui ficam os que so a tela ve: um clique que nao chega na rota,
  // um botao que aparece onde nao devia, uma resposta de outro mes pintada. Os
  // seis compilam, passam no lint e deixam a tela com a MESMA aparencia estatica
  // -- a diferenca esta no gesto, e gesto nao tem rede sem navegador
  // (`react-dom/server` nao ve handler).
  {
    // O CLIQUE QUE NAO CHEGA NA ROTA. A tela anda de mes, o rotulo muda, e o
    // `fetch` continua pedindo o mes corrente: os numeros de outubro ficam
    // debaixo do rotulo "novembro de 2026". E a HMO-173 de novo, e e exatamente
    // o defeito que um teste que lesse so o rotulo nao veria.
    nome: "o fetch nao manda o mes (a tela anda, a rota nao)",
    arquivo: PAINEL,
    de: "`/api/papel-de-pao/painel?month=${mesPedido}`",
    para: '"/api/papel-de-pao/painel"',
  },
  {
    // A SETA TROCADA. As duas chamadas tem a mesma forma e o mesmo tipo, e o
    // unico sintoma e a direcao -- que nenhuma assercao estatica distingue.
    nome: "a seta da direita anda para TRAS",
    arquivo: PAINEL,
    de: "onClick={() => setPeriodo(passoDeMes(periodo, 1))}",
    para: "onClick={() => setPeriodo(passoDeMes(periodo, -1))}",
  },
  {
    // O EFEITO QUE NAO DEPENDE DO MES. Com a lista de dependencias vazia, o
    // pedido acontece UMA vez e as setas passam a trocar so o rotulo. O
    // `exhaustive-deps` reclamaria num `npm run lint`; este runner nao roda
    // lint, e o ponto e que a SUITE tem de reprovar sozinha.
    nome: "o efeito nao refaz o pedido quando o mes muda",
    arquivo: PAINEL,
    de: "  }, [mesPedido]);",
    para: "  }, []);",
  },
  {
    // A RESPOSTA DE OUTRO MES, PINTADA. Sem a guarda, o cache do PWA (24h nas
    // rotas /api/) poe os numeros de um mes debaixo do rotulo de outro -- e os
    // numeros sao plausiveis, porque sao numeros de verdade.
    nome: "a tela pinta resposta de qualquer mes (a guarda do `month` sai)",
    arquivo: PAINEL,
    de: "        if (dados.month !== mesPedido) {",
    para: "        if (false) {",
  },
  {
    // A GUARDA INVERTIDA: descarta exatamente o que deveria aceitar. O painel
    // fica "indisponivel agora" para sempre, com a conta certa chegando pela
    // rede -- e quem morre aqui e o CONTROLE POSITIVO do caso F, nao a assercao
    // do descarte.
    nome: "a guarda do `month` esta invertida (descarta o mes certo)",
    arquivo: PAINEL,
    de: "        if (dados.month !== mesPedido) {",
    para: "        if (dados.month === mesPedido) {",
  },
  {
    // O "HOJE" SEMPRE NA TELA. Um botao que nao tem para onde levar, no mes em
    // que a pessoa ja esta. O criterio 2 da issue e literalmente este par, e so
    // uma assercao nos DOIS sentidos o mede.
    nome: "o `Hoje` aparece tambem no mes corrente",
    arquivo: PAINEL,
    de: "        {!noMesCorrente && (",
    para: "        {true && (",
  },
  {
    // O "HOJE" COMO UM PASSO PARA TRAS. A dois meses de distancia ele deixa a
    // pessoa no mes seguinte, nao no corrente -- e a um mes de distancia os dois
    // sao indistinguiveis, que e por que a sonda o clica de longe.
    nome: "o `Hoje` anda um mes para tras em vez de voltar para hoje",
    arquivo: PAINEL,
    de: 'onClick={() => setPeriodo(periodoCorrente())}',
    para: "onClick={() => setPeriodo(passoDeMes(periodo, -1))}",
  },
  {
    // A ANCORA DA SONDA, como no `data-rotulo` acima: sem `data-mes`, a leitura
    // do mes na tela vem `null` e "o mes mudou" deixa de ser mensuravel. Quem o
    // mata sao as assercoes que comparam `mesNaTela` com o oraculo.
    nome: "o `data-mes` muda de nome (a sonda perde o mes da tela)",
    arquivo: PAINEL,
    de: "data-mes={mesPedido}",
    para: "data-mes-do-painel={mesPedido}",
  },

  // ===========================================================================
  // O TERCEIRO CARTAO -- HMO-296 (6/6)
  // ===========================================================================
  // A ARITMETICA do cartao nao esta aqui: ela e pura, mora em `sobraOuFalta`
  // (lib/papel-de-pao.ts) e tem runner proprio em
  // `scripts/mutantes-sobra-ou-falta.mjs`, com os tres mutantes que a issue
  // nomeia. Os de baixo sao os que SO A TELA ve -- os quatro jeitos de o cartao
  // certo chegar errado na tela, todos compilando e todos com a mesma aparencia
  // estatica.
  {
    // O CARTAO QUE NAO EXISTE. A forma mais crua: a feature inteira desligada,
    // com a rota continuando a calcular e a responder o cartao. Quem o mata e a
    // contagem EXATA de tres cartoes do caso D -- com um `>=`, este mutante
    // sobreviveria.
    nome: "o terceiro cartao sai da tela",
    arquivo: PAINEL,
    de: `      <CartaoDeSobra
        cartao={estado.fase === "pronto" ? estado.dados.sobra_ou_falta : undefined}
        fase={estado.fase}
      />
`,
    para: "",
  },
  {
    // A LINHA DAS PARCELAS SOME. O criterio 2 da issue e literalmente ela: sem
    // a conferencia, tres numeros no painel que nao fecham de olho sao
    // exatamente a forma como este app ja enganou alguem antes. O cartao
    // continua certo, e e por isso que nenhuma assercao sobre valor o pega.
    nome: "a linha das duas parcelas nao e renderizada",
    arquivo: PAINEL,
    de: "        {parcelas && (",
    para: "        {false && (",
  },
  {
    // AS PARCELAS TROCADAS NA TELA. "Receitas R$ 3.980,50 - Despesas
    // R$ 9.500,00" debaixo de "Quanto Sobra: R$ 5.519,50": a linha que existe
    // para ser conferida passa a nao fechar com o numero em cima dela. Os dois
    // campos sao `number` e os dois rotulos sao `string`, entao nada alem da
    // sonda ve a troca.
    nome: "as duas parcelas aparecem trocadas na tela",
    arquivo: PAINEL,
    de: "{ROTULO_DAS_RECEITAS} {formatCurrency(parcelas.receitas)}",
    para: "{ROTULO_DAS_RECEITAS} {formatCurrency(parcelas.despesas)}",
  },
  {
    // O TITULO AFIRMATIVO NO ESTADO SEM RESPOSTA. Em vez do nome inteiro do
    // cartao -- a pergunta em aberto --, a tela escolhe um dos dois lados dela
    // antes de ler o banco: "Quanto Sobra" sobre um cartao indisponivel, que e
    // uma afirmacao sobre o dinheiro de alguem feita sem dado nenhum.
    nome: "o cartao sem resposta ja diz `Quanto Sobra`",
    arquivo: PAINEL,
    de: "const titulo = cartao?.titulo ?? TITULO_SEM_RESPOSTA;",
    para: 'const titulo = cartao?.titulo ?? "Quanto Sobra";',
  },
  {
    // O `?? 0` DA TELA, que e o mutante do `null` um nivel acima do da lib:
    // `valor === null` deixa de virar *indisponivel* e vira "R$ 0,00" --
    // "Quanto Sobra ou Quanto Falta: R$ 0,00" num mes que nao foi lido.
    // O mutante e escrito nas DUAS pontas de proposito -- a guarda e a
    // formatacao --, porque so a guarda nao compila: `formatCurrency` recebe
    // `number` e `cartao.valor` e `number | null`. E assim ele e o defeito que
    // alguem de fato escreveria para "fazer o tsc parar de reclamar".
    nome: "a tela pinta zero onde o cartao esta indisponivel",
    arquivo: PAINEL,
    de: `          ) : cartao == null || cartao.valor === null ? (
            <span className="text-muted-foreground text-xl">
              indisponível agora
            </span>
          ) : (
            formatCurrency(cartao.valor)
          )}`,
    para: `          ) : cartao == null ? (
            <span className="text-muted-foreground text-xl">
              indisponível agora
            </span>
          ) : (
            formatCurrency(cartao.valor ?? 0)
          )}`,
  },
];

const SUITES = ["test:papel-na-tela"];

const bloco = criarBlocoDeMutantes({ rotulo: "painel-na-tela", suites: SUITES });

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

// CONTROLE POSITIVO, primeiro e obrigatorio: a suite tem de passar com a
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
    if (r.mudouASaida === false) {
      console.error("  (saida compilada identica a da arvore limpa: EQUIVALENTE)");
    }
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
