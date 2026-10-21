// CONTROLE NEGATIVO de `npm run test:conversa-do-papel` -- HMO-464, F1 do plano
// da HMO-462.
//
// A issue pede, com estas palavras, que "cada transicao do motor tem que ter um
// mutante que a suite mata". Este runner e essa lista: ele estraga
// `lib/conversa-do-papel.ts` de proposito, uma mudanca por vez, e exige que a
// suite REPROVE em todas. Um mutante SOBREVIVENTE e um buraco na suite.
//
// POR QUE ESTA SUITE PRECISA MAIS DISSO QUE A MEDIA
// -------------------------------------------------
// Ela e quase toda feita de assercoes sobre TEXTO (frases da conversa, rotulos
// de botao) e sobre IDENTIDADE de objeto (`proxima === atual`, que e como o
// motor diz "nada aconteceu"). Os dois tipos sao justamente os que passam
// verde sem medir nada: um `includes` casa com um comentario, e uma assercao
// que nunca alcanca o objeto novo nao distingue "o gesto foi ignorado" de "o
// gesto reiniciou a digitacao".
//
// NAO RESTAURA NADA, PORQUE NAO MUTA NADA
// ---------------------------------------
// A mutacao e escrita numa SOMBRA em diretorio temporario (`mutantes-em-bloco`)
// e `lib/conversa-do-papel.ts` nunca e tocado. Nao ha `git checkout` de
// restauracao -- ele restauraria a partir do INDICE, e num worktree
// compartilhado isso ja apagou trabalho nao commitado neste repositorio -- e
// nao ha reescrita em memoria, que `process.on("exit")` nao garante em SIGTERM
// (o sinal que o `timeout` do shell e o cancelamento de job mandam).
//
// E A COMPILACAO E UMA SO para todas as voltas: a sombra e montada uma vez e o
// AST de tudo que nao e o arquivo mutado e reaproveitado. O pipeline vem do
// proprio alvo `test:conversa-do-papel` do package.json -- inclusive as DUAS
// voltas de fuso (`TZ=America/Sao_Paulo` e `TZ=UTC`), que e o que mata o
// mutante do relogio lido por dentro.
//
// Cada mutante e conferido antes de rodar, e por OCORRENCIA UNICA: um `replace`
// que nao casa com nada nao muda o texto e a suite passaria -- o que se le como
// "mutante sobreviveu" quando o mutante nunca existiu --, e uma ancora que casa
// duas vezes muta a primeira ocorrencia, que pode nao ser a que o nome promete.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const FONTE = "lib/conversa-do-papel.ts";
const SUITE = "test:conversa-do-papel";

const mutantes = [
  // ------------------------------------------------------------------------
  // 1. Saudacao
  // ------------------------------------------------------------------------
  {
    nome: "a saudacao usa o nome INTEIRO do cadastro",
    arquivo: FONTE,
    de: "  return limpo.split(/\\s+/)[0];",
    para: "  return limpo;",
  },
  {
    nome: "sem nome a saudacao fica 'Olá , o que deseja?'",
    arquivo: FONTE,
    de: "      return conversa.nome\n        ? `Olá ${conversa.nome}, o que deseja?`\n        : \"Olá, o que deseja?\";",
    para: "      return `Olá ${conversa.nome}, o que deseja?`;",
  },
  {
    nome: "o nome nao e limpo de espaco (um full_name de ' ' vira nome)",
    arquivo: FONTE,
    de: "  const limpo = (nomeCompleto ?? \"\").trim();",
    para: "  const limpo = nomeCompleto ?? \"\";",
  },
  {
    nome: "Saldo sai da saudacao (ela perde o terceiro botao)",
    arquivo: FONTE,
    de: "        { gesto: \"gastei\", rotulo: \"Gastei\" },\n        { gesto: \"ganhei\", rotulo: \"Ganhei\" },\n        { gesto: \"saldo\", rotulo: \"Saldo\" },",
    para: "        { gesto: \"gastei\", rotulo: \"Gastei\" },\n        { gesto: \"ganhei\", rotulo: \"Ganhei\" },",
  },
  {
    nome: "a ordem dos tres botoes muda (Saldo primeiro)",
    arquivo: FONTE,
    de: "        { gesto: \"gastei\", rotulo: \"Gastei\" },\n        { gesto: \"ganhei\", rotulo: \"Ganhei\" },\n        { gesto: \"saldo\", rotulo: \"Saldo\" },\n      ];\n    case \"digitando\":",
    para: "        { gesto: \"saldo\", rotulo: \"Saldo\" },\n        { gesto: \"gastei\", rotulo: \"Gastei\" },\n        { gesto: \"ganhei\", rotulo: \"Ganhei\" },\n      ];\n    case \"digitando\":",
  },
  {
    // A TRAVA DO RELOGIO. Sem ela um `hoje` sujo nao deixa a tela estranha --
    // deixa o saldo respondendo por outro mes com a mesma cara de certo.
    nome: "o motor aceita um `hoje` que nao e data",
    arquivo: FONTE,
    de: "  if (!ehDataIso(entrada.hoje)) {\n    throw new Error(",
    para: "  if (false as boolean) {\n    throw new Error(",
  },
  {
    nome: "gesto solto na saudacao devolve uma COPIA (toque perdido repinta a tela)",
    arquivo: FONTE,
    de: "      if (gesto.tipo === \"voltar\") {\n        return conversa.estado === \"pronto\" ? doZero(conversa) : conversa;\n      }\n      return conversa;",
    para: "      if (gesto.tipo === \"voltar\") {\n        return conversa.estado === \"pronto\" ? doZero(conversa) : conversa;\n      }\n      return { ...conversa };",
  },

  // ------------------------------------------------------------------------
  // 2. Digitando o valor
  // ------------------------------------------------------------------------
  {
    nome: "a pergunta do teclado ignora a direcao (Ganhei pergunta 'quanto gastou')",
    arquivo: FONTE,
    de: "      return conversa.direcao === \"ganhei\"\n        ? \"Quanto você ganhou?\"\n        : \"Quanto você gastou?\";",
    para: "      return \"Quanto você gastou?\";",
  },
  {
    nome: "Ganhei abre o teclado como Gastei (a direcao e chumbada)",
    arquivo: FONTE,
    de: "function aoEscolherDirecao(conversa: Conversa, direcao: Direcao): Conversa {\n  return {\n    ...conversa,\n    estado: \"digitando\",\n    direcao,",
    para: "function aoEscolherDirecao(conversa: Conversa, direcao: Direcao): Conversa {\n  return {\n    ...conversa,\n    estado: \"digitando\",\n    direcao: \"gastei\",",
  },
  {
    nome: "o teclado nasce com o valor do lancamento anterior",
    arquivo: FONTE,
    de: "    estado: \"digitando\",\n    direcao,\n    digitos: \"\",\n    lancamento: null,",
    para: "    estado: \"digitando\",\n    direcao,\n    lancamento: null,",
  },
  {
    nome: "o zero a esquerda acumula (0 depois 5 vira cinquenta centavos)",
    arquivo: FONTE,
    de: "  const proximo = `${digitos}${tecla}`.replace(/^0+/, \"\");",
    para: "  const proximo = `${digitos}${tecla}`;",
  },
  {
    nome: "o teto de digitos desaparece",
    arquivo: FONTE,
    de: "  if (proximo.length > MAX_DIGITOS) return digitos;",
    para: "",
  },
  {
    nome: "o teto erra em um digito (aceita o 16o)",
    arquivo: FONTE,
    de: "  if (proximo.length > MAX_DIGITOS) return digitos;",
    para: "  if (proximo.length > MAX_DIGITOS + 1) return digitos;",
  },
  {
    nome: "tecla que nao e digito entra no acumulador",
    arquivo: FONTE,
    de: "  if (!/^[0-9]$/.test(tecla)) return digitos;",
    para: "",
  },
  {
    nome: "apagar tira DUAS teclas",
    arquivo: FONTE,
    de: "        return { ...conversa, digitos: conversa.digitos.slice(0, -1) };",
    para: "        return { ...conversa, digitos: conversa.digitos.slice(0, -2) };",
  },
  {
    nome: "apagar no campo vazio devolve uma copia",
    arquivo: FONTE,
    de: "        if (conversa.digitos === \"\") return conversa;",
    para: "",
  },
  {
    nome: "limpar nao limpa",
    arquivo: FONTE,
    de: "        return conversa.digitos === \"\" ? conversa : { ...conversa, digitos: \"\" };",
    para: "        return conversa;",
  },
  {
    nome: "o teclado deixa confirmar com zero",
    arquivo: FONTE,
    de: "        if (!podeConfirmar(conversa)) return conversa;",
    para: "",
  },
  {
    nome: "podeConfirmar aceita zero (`>= 0`)",
    arquivo: FONTE,
    de: "  return valorNumerico(valorPlano(conversa)) > 0;",
    para: "  return valorNumerico(valorPlano(conversa)) >= 0;",
  },
  {
    nome: "o botao Pronto aparece sem valor digitado",
    arquivo: FONTE,
    de: "      return podeConfirmar(conversa)\n        ? [\n            { gesto: \"confirmar\", rotulo: \"Pronto\" },\n            { gesto: \"voltar\", rotulo: \"Voltar\" },\n          ]\n        : [{ gesto: \"voltar\", rotulo: \"Voltar\" }];",
    para: "      return [\n        { gesto: \"confirmar\", rotulo: \"Pronto\" },\n        { gesto: \"voltar\", rotulo: \"Voltar\" },\n      ];",
  },
  {
    nome: "o campo vazio mostra nada em vez de zero",
    arquivo: FONTE,
    de: "  return aoDigitarValor(conversa.digitos).exibicao || formatarValor(0);",
    para: "  return aoDigitarValor(conversa.digitos).exibicao;",
  },
  {
    nome: "Voltar do teclado guarda a direcao e os digitos",
    arquivo: FONTE,
    de: "      if (gesto.tipo === \"voltar\") return doZero(conversa);\n      return conversa;\n\n    case \"confirmando\":",
    para: "      if (gesto.tipo === \"voltar\") return { ...conversa, estado: \"saudacao\" };\n      return conversa;\n\n    case \"confirmando\":",
  },

  // ------------------------------------------------------------------------
  // 3. Confirmacao
  // ------------------------------------------------------------------------
  {
    nome: "a confirmacao diz sempre 'Gastei', inclusive para Ganhei",
    arquivo: FONTE,
    de: "      return `${conversa.direcao === \"ganhei\" ? \"Ganhei\" : \"Gastei\"} ${valorNaTela(\n        conversa\n      )}, certo?`;",
    para: "      return `Gastei ${valorNaTela(conversa)}, certo?`;",
  },
  {
    nome: "a confirmacao mostra os digitos crus em vez do valor",
    arquivo: FONTE,
    de: "      )}, certo?`;",
    para: "      )}`.replace(valorNaTela(conversa), conversa.digitos) + \", certo?\";",
  },
  {
    nome: "o lancamento vai para a rota JA com o sinal (o sinal passa a morar em dois lugares)",
    arquivo: FONTE,
    de: "            valor: valorPlano(conversa),",
    para: "            valor: `-${valorPlano(conversa)}`,",
  },
  {
    nome: "a data do lancamento e um relogio chumbado, nao o parametro",
    arquivo: FONTE,
    de: "            data: conversa.hoje,",
    para: "            data: \"2026-10-20\",",
  },
  {
    nome: "'Não, corrigir' apaga o valor digitado",
    arquivo: FONTE,
    de: "        return { ...conversa, estado: \"digitando\", lancamento: null };",
    para: "        return { ...conversa, estado: \"digitando\", digitos: \"\", lancamento: null };",
  },
  {
    nome: "'Não, corrigir' volta para a saudacao em vez do teclado",
    arquivo: FONTE,
    de: "        return { ...conversa, estado: \"digitando\", lancamento: null };",
    para: "        return doZero(conversa);",
  },
  {
    nome: "tecla ainda muda o valor DEBAIXO da pergunta de confirmacao",
    arquivo: FONTE,
    de: "        return { ...conversa, estado: \"digitando\", lancamento: null };\n      }\n      return conversa;",
    para: "        return { ...conversa, estado: \"digitando\", lancamento: null };\n      }\n      if (gesto.tipo === \"digito\") {\n        return { ...conversa, digitos: acrescentarDigito(conversa.digitos, gesto.digito) };\n      }\n      return conversa;",
  },
  {
    nome: "os dois botoes da confirmacao trocam de lugar (o 'Não' vira o primeiro)",
    arquivo: FONTE,
    de: "        { gesto: \"confirmar\", rotulo: \"Sim, anotar\" },\n        { gesto: \"voltar\", rotulo: \"Não, corrigir\" },",
    para: "        { gesto: \"voltar\", rotulo: \"Não, corrigir\" },\n        { gesto: \"confirmar\", rotulo: \"Sim, anotar\" },",
  },
  {
    nome: "o teclado continua aberto na confirmacao",
    arquivo: FONTE,
    de: "  return conversa.estado === \"digitando\";",
    para: "  return conversa.estado === \"digitando\" || conversa.estado === \"confirmando\";",
  },

  // ------------------------------------------------------------------------
  // 4. Pronto
  // ------------------------------------------------------------------------
  {
    nome: "o resultado nao diz o valor ('Anotado.' sozinho)",
    arquivo: FONTE,
    de: "  return `${palavra} ${formatarValor(valorNumerico(valor))}. Anotado.`;",
    para: "  return \"Anotado.\";",
  },
  {
    nome: "o resultado nao diz a direcao (Ganhei aparece como Gastei)",
    arquivo: FONTE,
    de: "  const palavra = direcao === \"ganhei\" ? \"Ganhei\" : \"Gastei\";",
    para: "  const palavra = \"Gastei\";",
  },
  {
    nome: "o resultado vaza para a confirmacao (frase de anotado sem ter anotado)",
    arquivo: FONTE,
    de: "  if (conversa.estado !== \"pronto\" || !conversa.lancamento) return null;",
    para: "  if (!conversa.lancamento) return null;",
  },
  {
    nome: "o lancamento nao sobrevive ao Pronto (F4 fica sem o corpo do POST)",
    arquivo: FONTE,
    de: "        return { ...conversa, estado: \"pronto\" };",
    para: "        return { ...conversa, estado: \"pronto\", lancamento: null };",
  },
  {
    nome: "confirmar na confirmacao nao caminha (a conversa trava)",
    arquivo: FONTE,
    de: "        return { ...conversa, estado: \"pronto\" };",
    para: "        return conversa;",
  },
  {
    nome: "Voltar no Pronto nao dispensa a frase do resultado",
    arquivo: FONTE,
    de: "        return conversa.estado === \"pronto\" ? doZero(conversa) : conversa;",
    para: "        return conversa;",
  },

  // ------------------------------------------------------------------------
  // 5. Saldo
  // ------------------------------------------------------------------------
  {
    // O MUTANTE DO RELOGIO. Ele e o que as duas voltas de fuso do alvo existem
    // para matar: `periodoCorrente()` sem argumento le o `today()` do aparelho.
    nome: "o periodo do saldo le o relogio em vez do parametro",
    arquivo: FONTE,
    de: "  return mesCorrenteDaConversa(conversa.hoje);",
    para: "  return mesCorrenteDaConversa();",
  },
  {
    nome: "o rotulo do mes e cravado em vez de nascer da janela consultada",
    arquivo: FONTE,
    de: "  return rotuloDoPeriodo({ ...mes, modo: modoDoPeriodo(mes.de, mes.ate) });",
    para: "  return \"outubro de 2026\";",
  },
  {
    nome: "o Saldo nao diz de que mes ele fala",
    arquivo: FONTE,
    de: "      return `Seu saldo de ${rotuloDoSaldo(conversa)}`;",
    para: "      return \"Seu saldo\";",
  },
  {
    nome: "a tela do saldo mostra SO o saldo (a aritmetica deixa de ser conferivel)",
    arquivo: FONTE,
    de: "    { rotulo: \"Ganhei\", valor: formatarValor(tres.ganhei) },\n    { rotulo: \"Gastei\", valor: formatarValor(tres.gastei) },\n",
    para: "",
  },
  {
    nome: "o saldo e RECALCULADO aqui (a tela fecha sempre e para de denunciar F2)",
    arquivo: FONTE,
    de: "    { rotulo: \"Saldo\", valor: formatarValor(tres.saldo) },",
    para: "    { rotulo: \"Saldo\", valor: formatarValor(tres.ganhei - tres.gastei) },",
  },
  {
    nome: "o sinal do Gastei e absorvido por um Math.abs caridoso",
    arquivo: FONTE,
    de: "    { rotulo: \"Gastei\", valor: formatarValor(tres.gastei) },",
    para: "    { rotulo: \"Gastei\", valor: formatarValor(Math.abs(tres.gastei)) },",
  },
  {
    nome: "as tres linhas do saldo saem fora de ordem",
    arquivo: FONTE,
    de: "    { rotulo: \"Ganhei\", valor: formatarValor(tres.ganhei) },\n    { rotulo: \"Gastei\", valor: formatarValor(tres.gastei) },\n    { rotulo: \"Saldo\", valor: formatarValor(tres.saldo) },",
    para: "    { rotulo: \"Saldo\", valor: formatarValor(tres.saldo) },\n    { rotulo: \"Ganhei\", valor: formatarValor(tres.ganhei) },\n    { rotulo: \"Gastei\", valor: formatarValor(tres.gastei) },",
  },
  {
    nome: "do Saldo ela nao consegue sair (o Voltar some)",
    arquivo: FONTE,
    de: "      if (gesto.tipo === \"voltar\") return doZero(conversa);\n      return conversa;\n  }\n}",
    para: "      return conversa;\n  }\n}",
  },
  {
    nome: "do Saldo o Gastei nao abre o teclado",
    arquivo: FONTE,
    de: "      if (gesto.tipo === \"gastei\" || gesto.tipo === \"ganhei\") {\n        return aoEscolherDirecao(conversa, gesto.tipo);\n      }\n      if (gesto.tipo === \"voltar\") return doZero(conversa);",
    para: "      if (gesto.tipo === \"voltar\") return doZero(conversa);",
  },
  {
    nome: "o botao Saldo nao leva ao saldo",
    arquivo: FONTE,
    de: "        return { ...conversa, estado: \"saldo\", direcao: null, lancamento: null };",
    para: "        return conversa;",
  },

  // ------------------------------------------------------------------------
  // 6. O vocabulario -- a uniao fechada de gestos
  // ------------------------------------------------------------------------
  {
    // O defeito que o plano proibe com mais palavras: um controle a mais
    // nascendo na conversa. O ROTULO e o que uma pessoa veria ("Categoria"), e
    // o `gesto` reaproveita um dos oito porque um `tipo` novo em `Botao.gesto`
    // nao compila -- a uniao fechada e o outro guarda, e ela e do tsc.
    nome: "um quarto botao (um seletor) nasce na saudacao",
    arquivo: FONTE,
    de: "        { gesto: \"saldo\", rotulo: \"Saldo\" },\n      ];\n    case \"digitando\":",
    para: "        { gesto: \"saldo\", rotulo: \"Saldo\" },\n        { gesto: \"voltar\", rotulo: \"Categoria\" },\n      ];\n    case \"digitando\":",
  },
  {
    nome: "o teclado nasce com o zero antes do nove",
    arquivo: FONTE,
    de: "export const TECLAS = [\n  \"1\",",
    para: "export const TECLAS = [\n  \"0\",\n  \"1\",",
  },
  {
    nome: "um estado some da lista dos cinco",
    arquivo: FONTE,
    de: "  \"pronto\",\n  \"saldo\",\n] as const;",
    para: "  \"saldo\",\n] as const;",
  },
];

/**
 * SOBREVIVENTES ESPERADOS: mutantes que a suite tem de deixar PASSAR.
 *
 * Um runner que so cobra vermelho mede metade.
 *
 * OS DOIS PRIMEIROS mexem em codigo INALCANCAVEL: `conversa.direcao` e
 * `Direcao | null` no tipo, e o `null` nunca chega nestes dois pontos -- em
 * `digitando` e `confirmando` a direcao sempre foi escolhida. Os dois
 * `?? "gastei"` / `=== "ganhei"` existem porque o tipo exige um valor ali, nao
 * porque haja um caso.
 *
 * Declara-los aqui e o que torna a afirmacao "inalcancavel" uma MEDICAO em vez
 * de uma crenca: no dia em que um refatorador deixar o `null` chegar nestes
 * pontos, o bloco abaixo vira "REPROVOU" e diz exatamente qual dos dois passou
 * a ser alcancavel -- em vez de a mudanca entrar calada, com os dois ramos
 * virando defaults de verdade sem ninguem ter escolhido o default.
 *
 * O TERCEIRO e defensivo contra uma mudanca que ainda nao aconteceu: o `modo`
 * do rotulo sai de `modoDoPeriodo` em vez de um `"mes"` digitado, e com a
 * janela de F2 sendo um mes inteiro os dois dao o MESMO rotulo. Cravar "mes"
 * sobrevive hoje, e e isso que se esta declarando: no dia em que a janela da
 * conversa deixar de ser um mes civil, esta linha vira "REPROVOU" e avisa que
 * o rotulo precisava passar a dizer "01/10 a 20/10". Prender isso na suite
 * exigiria falsificar a janela de F2, que e medida na suite DELA.
 *
 * O QUARTO diz DE QUEM e o guarda da uniao fechada de gestos, e ele comecou
 * como mutante que eu esperava matar. Ele sobreviveu, e esta certo em
 * sobreviver: acrescentar uma variante a `Gesto` nao muda COMPORTAMENTO nenhum
 * -- o `aoGesto` continua caindo no `return conversa`, que e o que a suite
 * mede. Quem barra o seletor de categoria no fonte e o tsc (a uniao e fechada e
 * `Botao.gesto` e `TipoDeGesto`), e a suite barra a consequencia visivel dele
 * (o quarto botao, o gesto que deixa de ser no-op). Ler isto como buraco da
 * suite levaria a escrever ali uma assercao que nao pode existir: `.mjs` nao
 * passa pelo tsc, e tipo nao existe em tempo de execucao.
 */
const sobreviventesEsperados = [
  {
    nome: "o default inalcancavel da direcao no lancamento vira 'ganhei'",
    arquivo: FONTE,
    de: "            direcao: conversa.direcao ?? \"gastei\",",
    para: "            direcao: conversa.direcao ?? \"ganhei\",",
  },
  {
    nome: "a pergunta do teclado pergunta pelo outro lado da comparacao",
    arquivo: FONTE,
    de: "      return conversa.direcao === \"ganhei\"\n        ? \"Quanto você ganhou?\"\n        : \"Quanto você gastou?\";",
    para: "      return conversa.direcao === \"gastei\"\n        ? \"Quanto você gastou?\"\n        : \"Quanto você ganhou?\";",
  },
  {
    nome: "o modo do periodo do rotulo e cravado em mes",
    arquivo: FONTE,
    de: "  return rotuloDoPeriodo({ ...mes, modo: modoDoPeriodo(mes.de, mes.ate) });",
    para: "  return rotuloDoPeriodo({ ...mes, modo: \"mes\" });",
  },
  {
    nome: "a uniao Gesto ganha um seletor de categoria (sem ramo que o atenda)",
    arquivo: FONTE,
    de: "  | { readonly tipo: \"voltar\" };",
    para: "  | { readonly tipo: \"voltar\" }\n  | { readonly tipo: \"categoria\"; readonly id: string };",
  },
];

const original = new Map();
for (const arquivo of new Set(
  [...mutantes, ...sobreviventesEsperados].map((m) => m.arquivo)
)) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

const bloco = criarBlocoDeMutantes({
  rotulo: "conversa-do-papel",
  suites: [SUITE],
});
// A sombra vive em diretorio temporario e sai junto com o processo -- inclusive
// nas saidas antecipadas abaixo. No pior caso (SIGTERM) sobra um diretorio
// orfao em /tmp; o que NAO sobra, e era o problema, e mutante no arquivo.
process.on("exit", () => bloco.fechar());

/** `true` se a suite PASSA com estas sobrescritas (`{}` = arvore intacta). */
const roda = (nome, sobrescritas = {}) =>
  bloco.rodar(nome, sobrescritas, SUITE).verde;

// CONTROLE POSITIVO: sem mutante, a suite tem de PASSAR. Se ela estiver
// vermelha por outro motivo, todo mutante "morre" e o placar fecha 100% sem
// medir nada. Ele roda pelo MESMO aparelho que os mutantes (a mesma sombra, a
// mesma compilacao, as mesmas duas voltas de fuso) -- e por isso ele pega erro
// no aparelho, e nao so na suite.
console.log("controle positivo (codigo intacto): a suite deve PASSAR");
if (!roda("controle")) {
  console.error("  REPROVOU -- conserte a suite antes de medir mutante");
  process.exit(1);
}
console.log("  ok, passou\n");

/** A ancora casa EXATAMENTE uma vez? Zero = mutante que nunca existiu. */
function ocorrencias(arquivo, de) {
  return original.get(arquivo).split(de).length - 1;
}

let sobreviventes = 0;
for (const m of mutantes) {
  const quantas = ocorrencias(m.arquivo, m.de);
  if (quantas !== 1) {
    console.error(`SOBREVIVEU (ancora casou ${quantas}x, esperava 1) :: ${m.nome}`);
    sobreviventes++;
    continue;
  }
  const antes = original.get(m.arquivo);
  const depois = antes.replace(m.de, m.para);
  if (depois === antes) {
    console.error(`SOBREVIVEU (replace nao mudou nada) :: ${m.nome}`);
    sobreviventes++;
    continue;
  }
  if (roda(m.nome, { [m.arquivo]: depois })) {
    console.error(`SOBREVIVEU :: ${m.nome}`);
    sobreviventes++;
  } else {
    console.log(`morreu     :: ${m.nome}`);
  }
}

let esperadosQueMorreram = 0;
if (sobreviventesEsperados.length > 0) {
  console.log("\nsobreviventes ESPERADOS (a suite deve deixar passar)");
  for (const m of sobreviventesEsperados) {
    const quantas = ocorrencias(m.arquivo, m.de);
    if (quantas !== 1) {
      console.error(`  ANCORA CASOU ${quantas}x, esperava 1 :: ${m.nome}`);
      esperadosQueMorreram++;
      continue;
    }
    const antes = original.get(m.arquivo);
    if (roda(m.nome, { [m.arquivo]: antes.replace(m.de, m.para) })) {
      console.log(`  ok, sobreviveu :: ${m.nome}`);
    } else {
      console.error(`  REPROVOU :: ${m.nome}`);
      console.error("    a suite esta medindo um ramo INALCANCAVEL -- ou ele");
      console.error("    deixou de ser inalcancavel, e ai o default virou real.");
      esperadosQueMorreram++;
    }
  }
}

console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mortos`);
process.exit(sobreviventes === 0 && esperadosQueMorreram === 0 ? 0 : 1);
