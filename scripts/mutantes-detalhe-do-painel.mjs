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
// Nao usa `git checkout` para restaurar: ele restauraria a partir do INDICE, e
// num worktree compartilhado isso ja apagou trabalho nao commitado aqui. A
// copia original vai para a memoria e volta de la, sempre.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

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
    de: "    detalhe.push(linhaDoDetalhe(linha, valor, ctx.meuUserId));",
    para:
      "    detalhe.push(\n" +
      "      linhaDoDetalhe(linha, Math.abs(Number(linha.amount) || 0), ctx.meuUserId)\n" +
      "    );",
  },
  {
    // A MESMA FAMILIA, pelo outro lado: a lista perde a fatura aberta
    // sintetizada. O total continua com ela -- a soma das linhas abertas fica
    // MENOR que o numero de cima, e o cartao se desmente sozinho.
    nome: "o detalhe descarta a fatura aberta sintetizada",
    arquivo: LIB,
    de: "    detalhe.push(linhaDoDetalhe(linha, valor, ctx.meuUserId));",
    para:
      "    if (linha.id != null)\n" +
      "      detalhe.push(linhaDoDetalhe(linha, valor, ctx.meuUserId));",
  },
  {
    // O DETALHE MONTADO POR FORA DA PENEIRA -- a segunda leitura que a issue
    // proibe, na forma mais plausivel: um `filter` que esqueceu o STATUS.
    // 'skipped' e 'cancelled' voltam para a lista e nao voltam para o total.
    nome: "o detalhe vem de um segundo filtro, que esquece skipped/cancelled",
    arquivo: LIB,
    de: "  return { total: centavos(total), quantidade, detalhe };",
    para:
      "  return {\n" +
      "    total: centavos(total),\n" +
      "    quantidade,\n" +
      "    detalhe: linhas\n" +
      "      .filter((l) => dentroDaJanela(l.due_date, ctx.janela) && aceita(l))\n" +
      "      .map((l) =>\n" +
      "        linhaDoDetalhe(\n" +
      "          l,\n" +
      "          Math.abs(\n" +
      "            Number(\n" +
      "              parteDoMembro(l.amount, l.group_id, ctx.membrosAtivosPorGrupo)\n" +
      "            ) || 0\n" +
      "          ),\n" +
      "          ctx.meuUserId\n" +
      "        )\n" +
      "      ),\n" +
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
  // ---------------------------------------------------------------------------
  {
    // O DEFEITO CARO: todo mundo pode editar tudo. A linha de grupo do OUTRO
    // membro ganha botao, a RLS recusa, e `UPDATE` recusado pela RLS volta 200
    // sem alterar nada -- o app diz "pronto" e a linha fica.
    nome: "`posso_editar` nao olha de quem e a linha",
    arquivo: LIB,
    de: "      gravada && meuUserId != null && linha.user_id === meuUserId,",
    para: "      gravada,",
  },
  {
    // A FATURA SINTETIZADA GANHA ACAO. Ela nao tem id de banco: a baixa
    // responde 404, que para quem clicou se le como "o app nao conseguiu".
    nome: "a linha nao gravada tambem ganha acao",
    arquivo: LIB,
    de: "      gravada && meuUserId != null && linha.user_id === meuUserId,",
    para: "      meuUserId != null && linha.user_id === meuUserId,",
  },
  {
    // FALHA ABERTO em vez de fechado: sem `meuUserId` toda linha vira
    // editavel. E o estado de uma rota que esqueceu de passar o campo -- e o
    // sintoma seria botao em linha alheia.
    nome: "sem `meuUserId`, toda linha gravada vira editavel",
    arquivo: LIB,
    de: "      gravada && meuUserId != null && linha.user_id === meuUserId,",
    para: "      gravada && (meuUserId == null || linha.user_id === meuUserId),",
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

const original = new Map();
for (const arquivo of new Set(mutantes.map((m) => m.arquivo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}
const restaurar = () => {
  for (const [arquivo, texto] of original) writeFileSync(arquivo, texto);
};
process.on("exit", restaurar);
process.on("SIGINT", () => process.exit(130));

/**
 * As DUAS suites, e nao uma.
 *
 * A aritmetica do detalhe vive em `test:papel-de-pao` (pura, <1s); o
 * comportamento da seta vive em `test:papel-na-tela` (navegador, ~8s). Um
 * mutante de `PainelDePapel.tsx` nao muda nada na primeira, e um da lib nao
 * muda nada na segunda: rodar so uma faria metade dos mutantes sobreviver por
 * estar medindo o arquivo errado.
 *
 * `papel-de-pao` roda PRIMEIRO porque e a barata -- e a que mata quase tudo.
 */
const roda = () => {
  for (const suite of ["test:papel-de-pao", "test:papel-na-tela"]) {
    try {
      execSync(`npm run ${suite}`, { stdio: "pipe" });
    } catch {
      return false;
    }
  }
  return true;
};

// CONTROLE POSITIVO, primeiro e obrigatorio: sem mutante as duas suites tem de
// PASSAR. Se alguma estiver vermelha por outro motivo -- um erro no proprio
// caminho da mutacao, um `.tmp` sujo, um Chromium que nao abriu --, todo
// mutante "morre" e o placar fecha 100% sem medir nada. O controle NEGATIVO
// nao pega isso: ele passa por outro caminho.
console.log("controle positivo (codigo intacto): as duas suites devem PASSAR");
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
