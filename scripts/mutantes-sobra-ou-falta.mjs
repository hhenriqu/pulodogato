// CONTROLE NEGATIVO do cartao "Quanto Sobra ou Quanto Falta" -- HMO-296 (6/6 do
// plano da HMO-279), medido por `npm run test:papel-de-pao`.
//
// OS TRES MUTANTES QUE DECIDEM ESTA ISSUE
// ---------------------------------------
// 1. O SINAL DO TITULO (`>= 0` virando `<= 0`). O valor do cartao e exibido em
//    MODULO, entao +300 e -300 imprimem o MESMO numero: uma suite que medisse so
//    o valor deixaria este mutante passar por dezenas de assercoes verdes com o
//    rotulo invertido -- "Quanto Falta: R$ 5.519,50" num mes que sobrou. Quem o
//    mata sao as assercoes que leem o TITULO, com um mes positivo e um negativo
//    no fixture.
//
// 2. A ORDEM (`receitas - despesas` virando `despesas - receitas`). Pelo mesmo
//    motivo do modulo, um fixture simetrico (1.000 contra 1.000) nao o mata: os
//    dois lados dao R$ 0,00 e "Quanto Sobra". Ele morre no mes com as duas
//    magnitudes DIFERENTES, e de novo pelo titulo.
//
// 3. A PROPAGACAO DO `null` (trocada por `?? 0`). Exige fixture com UMA perna
//    vazia e a outra cheia: com as duas vazias, `null` e `0` dao o mesmo
//    resultado e o mutante sobrevive. O caso que o mata e o do mes em que as
//    contas nao foram lidas -- onde o `?? 0` imprime "Quanto Sobra:
//    R$ 9.500,00", a afirmacao mais cara que esta tela consegue fazer.
//
// Os demais sao as outras formas do mesmo defeito, e cada um e um CONSERTO
// diferente: a perna das receitas virando o salario (a alternativa que a issue
// descartou -- fecha a conta na tela e mente no rotulo), o cartao somando o
// salario em vez das receitas, o valor indo para a tela com sinal, o zero
// cravado virando falta.
//
// POR QUE UM RUNNER NOVO, E NAO UM BLOCO NO `mutantes-mes-do-painel.mjs`
// ----------------------------------------------------------------------
// Sao os dois puros e medem a mesma suite, mas tratam de features diferentes --
// aquele e o passo de mes (HMO-295), este e o terceiro cartao -- e o nome do
// arquivo e o que diz, no log do CI, qual feature parou de ser medida. Nao e job
// novo: os dois sao passos do MESMO job de verificacao, que o custo do Actions
// aqui e o numero de JOBS, nao de passos.
//
// Nao usa `git checkout` para restaurar: ele restauraria a partir do INDICE, e
// num worktree compartilhado isso ja apagou trabalho nao commitado aqui. A
// copia original vai para a memoria e volta de la, sempre.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const LIB = "lib/papel-de-pao.ts";

const mutantes = [
  // ---------------------------------------------------------------------------
  // OS TRES DA ISSUE
  // ---------------------------------------------------------------------------
  {
    // 1. O SINAL DO TITULO. O numero exibido nao muda em NENHUM mes -- so o
    //    rotulo em cima dele. Nenhuma assercao sobre valor pega isto.
    nome: "o SINAL do titulo esta invertido (`<= 0` em vez de `>= 0`)",
    arquivo: LIB,
    de: "titulo: saldo >= 0 ? TITULO_SOBRA : TITULO_FALTA,",
    para: "titulo: saldo <= 0 ? TITULO_SOBRA : TITULO_FALTA,",
  },
  {
    // 2. A ORDEM DA SUBTRACAO. Com o modulo por cima, o valor e identico nas
    //    duas ordens: o mes que falta passa a dizer que sobra, pelo mesmo
    //    numero.
    nome: "a ORDEM da conta esta invertida (`despesas - receitas`)",
    arquivo: LIB,
    de: "const saldo = centavos(entra - sai);",
    para: "const saldo = centavos(sai - entra);",
  },
  {
    // 3. A PROPAGACAO DO `null`, trocada por `?? 0`. O cartao passa a afirmar
    //    sobre um mes que nao foi lido, e a afirmacao e plausivel: ela usa o
    //    numero de verdade da perna que FOI lida.
    nome: "indisponivel vira zero (`?? 0` no lugar da propagacao do null)",
    arquivo: LIB,
    de: `  if (entra === null || sai === null) {
    return {
      titulo: TITULO_SEM_RESPOSTA,
      valor: null,
      receitas: entra,
      despesas: sai,
    };
  }

  const saldo = centavos(entra - sai);`,
    para: "  const saldo = centavos((entra ?? 0) - (sai ?? 0));",
  },

  // ---------------------------------------------------------------------------
  // AS OUTRAS FORMAS DO MESMO DEFEITO
  // ---------------------------------------------------------------------------
  {
    // O `null` DE UMA PERNA SO deixa de contaminar -- e este e o defeito que o
    // `&&` escreve sozinho, por um caractere. Com uma perna vazia, `entra - sai`
    // coage o `null` para zero e o cartao afirma sobre o mes que falta ler.
    nome: "so o mes vazio dos DOIS lados e indisponivel (`&&` em vez de `||`)",
    arquivo: LIB,
    de: "  if (entra === null || sai === null) {",
    para: "  if (entra === null && sai === null) {",
  },
  {
    // O VALOR COM SINAL. "Quanto Falta: -R$ 300,00" diz a mesma coisa duas
    // vezes e com dois sinais -- e e o que sai se o modulo for esquecido.
    nome: "o valor vai para a tela COM sinal (sem o modulo)",
    arquivo: LIB,
    de: "    valor: Math.abs(saldo),",
    para: "    valor: saldo,",
  },
  {
    // ZERO CRAVADO VIRANDO FALTA. So a fronteira muda, e em todo outro mes o
    // cartao continua certo: e o mutante que mais facilmente atravessa uma
    // suite que nao tenha o caso do empate.
    nome: "zero cravado passa a ser FALTA (`> 0` em vez de `>= 0`)",
    arquivo: LIB,
    de: "titulo: saldo >= 0 ? TITULO_SOBRA : TITULO_FALTA,",
    para: "titulo: saldo > 0 ? TITULO_SOBRA : TITULO_FALTA,",
  },
  {
    // A ALTERNATIVA QUE A ISSUE DESCARTOU, escrita como mutante: a perna das
    // receitas recortada pela categoria Salario. A aritmetica FECHA na tela
    // (7.000 - 3.980,50) e o rotulo "Receitas" mente -- quem recebe aluguel ve
    // uma sobra MENOR do que a real, o erro na direcao cara.
    nome: "as `receitas` sao so o SALARIO (a alternativa descartada)",
    arquivo: LIB,
    de: `  const receitas = somarPerna(
    linhas,
    ctx,
    (linha) => direcaoDaAgenda(linha.direction) === "income"
  );`,
    para: `  const receitas = somarPerna(
    linhas,
    ctx,
    (linha) =>
      direcaoDaAgenda(linha.direction) === "income" &&
      linha.category_id != null &&
      deSalario.has(linha.category_id)
  );`,
  },
  {
    // O CARTAO LENDO A PERNA ERRADA. A perna nova continua certa e exposta na
    // resposta; so o cartao usa a outra. Os tipos sao identicos, entao nada
    // alem da suite ve isso.
    nome: "o cartao soma o SALARIO em vez das receitas",
    arquivo: LIB,
    de: "sobra_ou_falta: sobraOuFalta(receitas, total_de_contas),",
    para: "sobra_ou_falta: sobraOuFalta(salario_previsto, total_de_contas),",
  },
  {
    // A PERNA DAS RECEITAS INVERTIDA: ela passa a somar despesa. O cartao fica
    // sempre em R$ 0,00 e "Quanto Sobra" -- um painel que diz, todo mes, que a
    // conta fechou exatamente no zero.
    nome: "a perna das receitas soma DESPESA",
    arquivo: LIB,
    de: `  const receitas = somarPerna(
    linhas,
    ctx,
    (linha) => direcaoDaAgenda(linha.direction) === "income"
  );`,
    para: `  const receitas = somarPerna(
    linhas,
    ctx,
    (linha) => direcaoDaAgenda(linha.direction) === "expense"
  );`,
  },
  {
    // A DIRECAO AUSENTE deixando de calar o CARTAO: as duas pernas saem
    // indisponiveis (a guarda continua la) mas o cartao e montado com zeros.
    // O painel mostraria duas frases honestas e um "Quanto Sobra: R$ 0,00".
    nome: "direcao ausente cala os numeros, mas o cartao vira zero",
    arquivo: LIB,
    // A ANCORA GANHOU PARENTESES NA HMO-300: `semLinha` virou FUNCAO quando o
    // `detalhe` entrou em `NumeroDoPapel` (uma constante com array dentro
    // daria a MESMA lista para os tres numeros). Sem este ajuste o replace nao
    // casa, o arquivo nao muda, a suite passa -- e o relatorio diz
    // "SOBREVIVEU" sobre um mutante que nunca existiu.
    de: "      sobra_ou_falta: sobraOuFalta(semLinha(), semLinha()),",
    para:
      "      sobra_ou_falta: sobraOuFalta(\n" +
      "        { total: 0, quantidade: 0, detalhe: [] },\n" +
      "        { total: 0, quantidade: 0, detalhe: [] }\n" +
      "      ),",
  },
  {
    // AS DUAS PARCELAS TROCADAS. O valor e o titulo continuam certos, e o que
    // mente e a linha de CONFERENCIA -- justamente a que existe para a pessoa
    // poder conferir. "Receitas R$ 3.980,50 - Despesas R$ 9.500,00" com
    // "Quanto Sobra: R$ 5.519,50" em cima.
    nome: "as duas parcelas do cartao estao trocadas",
    arquivo: LIB,
    de: `    receitas: entra,
    despesas: sai,
  };
}`,
    para: `    receitas: sai,
    despesas: entra,
  };
}`,
  },
];

const original = new Map();
for (const arquivo of new Set(mutantes.map((m) => m.arquivo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}
const restaurar = () => {
  for (const [arquivo, texto] of original) writeFileSync(arquivo, texto);
};
process.on("exit", restaurar);
process.on("SIGINT", () => process.exit(130));
// E SIGTERM, que e o que um `timeout` ou um cancelamento de job manda: sem
// este handler o gancho de `exit` acima NAO roda, e a arvore fica MUTADA para
// quem vier depois -- um defeito introduzido pelo proprio controle negativo.
process.on("SIGTERM", () => process.exit(143));

const roda = () => {
  try {
    execSync("npm run test:papel-de-pao", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

// CONTROLE POSITIVO, primeiro e obrigatorio: sem mutante a suite tem de PASSAR.
// Se ela estiver vermelha por outro motivo -- um erro no proprio caminho da
// mutacao, um `.tmp` sujo, uma dependencia que nao compila -- todo mutante
// "morre" e o placar fecha 100% sem medir nada. O controle NEGATIVO nao pega
// isso: ele passa por outro caminho.
console.log("controle positivo (codigo intacto): a suite deve PASSAR");
if (!roda()) {
  console.error("  REPROVOU -- conserte a suite antes de medir mutante");
  process.exit(1);
}
console.log("  ok, passou\n");

let sobreviventes = 0;
for (const m of mutantes) {
  const antes = original.get(m.arquivo);
  // Um `replace` que nao casa com nada nao muda o arquivo, e a suite passa --
  // o que se le como "mutante sobreviveu", quando o mutante nunca existiu.
  if (!antes.includes(m.de)) {
    console.error(`SOBREVIVEU (ancora nao casou) :: ${m.nome}`);
    console.error(`  o texto buscado nao existe em ${m.arquivo}: ${m.de}`);
    sobreviventes++;
    continue;
  }
  const depois = antes.replace(m.de, m.para);
  if (depois === antes) {
    console.error(`SOBREVIVEU (replace nao mudou nada) :: ${m.nome}`);
    sobreviventes++;
    continue;
  }
  writeFileSync(m.arquivo, depois);
  const passou = roda();
  restaurar();
  if (passou) {
    console.error(`SOBREVIVEU :: ${m.nome}`);
    sobreviventes++;
  } else {
    console.log(`morreu     :: ${m.nome}`);
  }
}

console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mortos`);
process.exit(sobreviventes === 0 ? 0 : 1);
