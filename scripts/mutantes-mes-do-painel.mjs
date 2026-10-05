// CONTROLE NEGATIVO do PASSO DE MES do painel de papel -- HMO-295 (5/6 do plano
// da HMO-279), medido por `npm run test:papel-de-pao`.
//
// O MUTANTE QUE DECIDE ESTA ISSUE
// -------------------------------
// Ignorar o `?month=` e usar sempre o mes corrente. Ele e o unico defeito que
// desfaz a feature inteira sem deixar marca em lugar nenhum: a rota responde
// 200, os dois numeros estao certos (sao os de outubro), o rotulo da tela diz
// "novembro de 2026", e nada no tsc, no lint ou no `next build` ve diferenca --
// as duas pontas compilam e sao do mesmo tipo.
//
// E ele SO MORRE porque o `hoje` dos casos da suite e de um mes DIFERENTE do mes
// pedido em cada um deles. Um caso que pedisse o mes corrente seria sonda vacua:
// as duas respostas coincidem e ele passaria verde com o parametro inteiramente
// desligado. E o que torna este runner necessario -- a vacuidade daquele caso
// nao apareceria de nenhuma outra forma.
//
// POR QUE METADE DESTES MUTANTES VIVE NUM `route.ts`
// --------------------------------------------------
// Nenhuma suite deste repositorio importa um `route.ts` (ele arrasta
// `next/server` e o cliente do Supabase), entao a fiacao da rota e provada por
// assercao TEXTUAL -- e assercao sobre texto e o tipo que mais passa verde sem
// medir nada. Por isso ela leva mutante: cada um apaga ou desvia um elo, e a
// suite tem de reprovar. Os tres jeitos de o mes se perder entre a querystring e
// a janela (nao receber o `request`, ler o parametro errado, chamar a funcao
// certa com o argumento errado) sao mutantes separados de proposito: eles sao
// consertos diferentes, e um `exigido` generico passaria por dois deles.
//
// Nao usa `git checkout` para restaurar: ele restauraria a partir do INDICE, e
// num worktree compartilhado isso ja apagou trabalho nao commitado aqui. A
// copia original vai para a memoria e volta de la, sempre.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const LIB = "lib/papel-de-pao.ts";
const ROTA = "app/api/papel-de-pao/painel/route.ts";

const mutantes = [
  // ---------------------------------------------------------------------------
  // A ROTA
  // ---------------------------------------------------------------------------
  {
    // O MUTANTE DA ISSUE, na forma mais direta: a rota volta a calcular o mes
    // corrente por conta propria e o `?month=` nao chega a lugar nenhum.
    nome: "a rota ignora o `?month=` e usa sempre o mes corrente",
    arquivo: ROTA,
    de: "const janela = janelaDoMes(month, hoje);",
    para: "const janela = janelaDoMesCorrente(hoje);",
  },
  {
    // A FORMA SUTIL DO MESMO DEFEITO, e a que um `exigido("janelaDoMes")`
    // deixaria passar: a funcao certa E chamada, com o argumento jogado fora. E
    // por isso que a assercao da suite ancora no CALL SITE com os argumentos.
    nome: "a rota chama janelaDoMes com o mes jogado fora",
    arquivo: ROTA,
    de: "janelaDoMes(month, hoje)",
    para: "janelaDoMes(null, hoje)",
  },
  {
    // O NOME DO PARAMETRO. A rota le uma querystring que nenhuma tela manda, o
    // `month` chega `null` e tudo cai na rede do mes corrente -- com a feature
    // inteira desligada e nenhuma excecao em lugar nenhum.
    nome: "a rota le o parametro errado da querystring (`mes` em vez de `month`)",
    arquivo: ROTA,
    de: 'searchParams.get("month")',
    para: 'searchParams.get("mes")',
  },
  {
    // A `GET()` DE ANTES DESTA ISSUE. E o unico destes que o tsc tambem pegaria
    // (o `request.nextUrl` abaixo deixa de compilar) -- os outros, nao.
    nome: "a GET volta a nao receber o request",
    arquivo: ROTA,
    de: "export async function GET(request: NextRequest) {",
    para: "export async function GET() {",
  },
  {
    // O ECO. Com o `month` da resposta saindo do relogio, a tela descarta TODA
    // resposta de qualquer mes que nao o corrente: o painel fica "indisponivel"
    // em novembro com a conta certa por baixo. O defeito aparece como erro de
    // rede, que e o lugar onde ninguem vai procurar.
    nome: "o `month` da resposta sai do relogio, e nao da janela",
    arquivo: ROTA,
    de: "month: janela.de.slice(0, 7),",
    para: "month: hoje.slice(0, 7),",
  },
  {
    // A MATERIALIZACAO DA JANELA ERRADA. Este e o elo do "ver o mes seguinte":
    // sem ele, abrir novembro nao cria as linhas das regras recorrentes de
    // novembro e o painel diz "nenhuma conta prevista" num mes que tem contas.
    // O resto da rota continua correto, e e isso que o torna invisivel.
    nome: "a rota materializa outra janela, nao a do mes pedido",
    arquivo: ROTA,
    de: "janelaParaMaterializar(janela, hoje)",
    para: "janelaParaMaterializar({ de: hoje, ate: hoje }, hoje)",
  },
  {
    // A LEITURA FORA DA JANELA PEDIDA. A metade de baixo do recorte: com o
    // `lte` no fim do mes corrente, novembro devolve a intersecao vazia e o
    // painel fica vazio; com o mes pedido no passado, ele soma meses demais.
    nome: "a leitura das linhas nao usa o fim da janela pedida",
    arquivo: ROTA,
    de: '.lte("due_date", janela.ate)',
    para: '.lte("due_date", janelaDoMesCorrente(hoje).ate)',
  },

  // ---------------------------------------------------------------------------
  // A FUNCAO PURA
  // ---------------------------------------------------------------------------
  {
    // O MESMO DEFEITO, UM NIVEL ABAIXO: a rota passa o mes e a funcao o ignora.
    // Mata-lo exige o `hoje` do fixture ser de outro mes que o pedido.
    nome: "janelaDoMes ignora o mes e devolve sempre o corrente",
    arquivo: LIB,
    de: "  const mes = mesPedido(month);\n  if (mes === null) return janelaDoMesCorrente(hoje);",
    para: "  const mes = mesPedido(month);\n  return janelaDoMesCorrente(hoje);",
  },
  {
    // A REDE AO CONTRARIO: mes invalido deixa de cair no corrente e vira um
    // `periodoDoMes("undefined-01")`, que devolve `de: "undefin-01"` -- uma
    // janela que nao casa com data nenhuma. O painel fica vazio para quem
    // chegou por link estragado, em vez de ver o mes corrente.
    nome: "mes invalido NAO cai no mes corrente",
    arquivo: LIB,
    de: "  if (mes === null) return janelaDoMesCorrente(hoje);",
    para: "",
  },
  {
    // A GUARDA DE TIPO. Sem ela, `?month=a&month=b` (que chega como array em
    // varios clientes) atravessa a interpolacao como `"a,b"`... e o caso que de
    // fato passa e `["2026-11"]`, que vira `"2026-11"` e e aceito. A suite tem
    // o array na lista de invalidos justamente para isto.
    nome: "mesPedido aceita o que nao e string (array vira mes valido)",
    arquivo: LIB,
    de: '  if (typeof month !== "string") return null;',
    para: "",
  },
  {
    // A GUARDA DO MES QUE NAO EXISTE. `2026-13` tem o formato certo, e
    // `Date.UTC(2026, 13, 0)` e um janeiro de 2027 perfeitamente valido: a
    // janela sairia de um mes inexistente e o rotulo de `MESES_PT[12]`, que e
    // `undefined`. E o unico defeito desta funcao que a tela mostraria.
    nome: "mesPedido aceita mes que nao existe (2026-13)",
    arquivo: LIB,
    de: "  return ehDataIso(`${month}-01`) ? month : null;",
    para: "  return month;",
  },
  {
    // A JANELA DE UM MES SO, pelo lado do fim. `ultimoDiaDoMes` recalculado e o
    // que faz fevereiro ter 28 e abril 30; preso em 31, a conta do dia 1o do mes
    // seguinte entra no mes anterior -- e a diferenca sai dos dois numeros sem
    // aparecer em lugar nenhum da tela.
    nome: "a janela do mes pedido termina sempre no dia 31",
    arquivo: LIB,
    de: "  const { de, ate } = periodoDoMes(`${mes}-01`);\n  return { de, ate };",
    para: '  const { de } = periodoDoMes(`${mes}-01`);\n  return { de, ate: `${mes}-31` };',
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
