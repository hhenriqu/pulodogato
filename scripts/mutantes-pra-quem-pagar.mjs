#!/usr/bin/env node
// Prova de mutacao do "pra quem pagar" (HMO-365, F2 da HMO-360).
//
//   node scripts/mutantes-pra-quem-pagar.mjs
//
// Cada entrada estraga uma decisao de `lib/pra-quem-pagar.ts` ou de
// `components/movimentacoes/PainelPraQuemPagar.tsx`, e a suite correspondente
// tem de ficar VERMELHA. Mutante que sobrevive e um trecho que nenhum teste
// distingue, ou codigo morto.
//
// DUAS SUITES, E CADA MUTANTE SABE A SUA
// --------------------------------------
//   * `test:pra-quem-pagar`          -- a aritmetica e o rotulo, no node (~0,2s)
//   * `test:pra-quem-pagar-na-tela`  -- a MARCACAO, num Chromium (~2s)
//
// A separacao nao e so de velocidade: um mutante de JSX nao tem como morrer na
// suite de aritmetica, e marcar a suite errada produziria "sobreviveu" sobre um
// defeito que a outra suite pega -- o pior relato possivel, porque manda
// consertar o que nao esta quebrado. Cada mutante roda nas DUAS, parando na
// primeira que mata, e o rotulo diz qual matou.
//
// OS DOIS QUE A ISSUE NOMEIA ESTAO NO TOPO
// ----------------------------------------
//   * `rotulo_pelo_nome_cru` -- a tela imprime `destino.nome` em vez do rotulo
//     pronto. Com o perfil legivel a diferenca e cosmetica ("Letícia" em vez de
//     "Pagar para Letícia"); com o perfil ILEGIVEL o elemento renderiza NADA, e
//     a linha de pagamento sem destinatario se le como conta propria -- o
//     usuario conclui que a divida e dele. E o defeito inteiro da issue, e ele
//     nao da sintoma nenhum: nao quebra build, nao fica vazio na maioria dos
//     perfis (`is_public` tem DEFAULT true), e so aparece para quem desligou o
//     perfil publico;
//   * `fallback_sem_mencao` -- o rotulo de fallback perde a mencao a outra
//     pessoa e vira so o verbo ("Pagar para "). O selo em branco, que e
//     exatamente o que `ser-do-mesmo-grupo-nao-da-acesso-ao-perfil` mediu.
//
// UM SOBREVIVENTE CONHECIDO, DITO EM VOZ ALTA
// -------------------------------------------
// `marca_calculada_a_parte` (trocar `destino.rotulo.temNome` por
// `destino.nome ? "sim" : "nao"` no `data-tem-nome`) e EQUIVALENTE, e por isso
// nao esta na lista. `destinosDoPagamento` ja normaliza o nome em branco para
// `null` antes de montar o objeto (`const limpo = (nome ?? "").trim() || null`),
// entao os dois lados concordam em toda entrada que a lib produz. O mutante que
// ele existiria para pegar e o da LIB -- `nome_em_branco_vira_nome`, logo abaixo
// --, e esse morre. Sobrevivente conhecido omitido em silencio e indistinguivel
// de sobrevivente escondido, e e por isso que isto esta escrito aqui.
//
// AS TRAVAS QUE ESTE RUNNER NAO DISPENSA
// --------------------------------------
// 1. O TRECHO APARECE EXATAMENTE UMA VEZ. `String.replace` com string troca a
//    PRIMEIRA ocorrencia: um alvo que aparece duas vezes muta um lugar que o
//    rotulo nao descreve, e a linha de saida passa a mentir sobre o que mediu.
// 2. A SUITE ESTA VERDE ANTES. Suite ja vermelha faz todo mutante "morrer" sem
//    nada ter sido medido -- 100% de mortalidade com zero poder de deteccao.
// 3. A ARVORE RASTREADA NAO E TOCADA: `criarBlocoDeMutantes` espelha o repo em
//    diretorio temporario e muta so la.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const LIB = "lib/pra-quem-pagar.ts";
const TELA = "components/movimentacoes/PainelPraQuemPagar.tsx";

const mutantes = [
  // -------------------------------------------------------------------------
  // OS DOIS DA ISSUE: o rotulo que deixa de mencionar a outra pessoa
  // -------------------------------------------------------------------------
  [
    TELA,
    "rotulo_pelo_nome_cru: a tela imprime o nome cru e o perfil ilegivel fica SEM rotulo",
    "            {destino.rotulo.texto}",
    "            {destino.nome}",
  ],
  [
    LIB,
    "fallback_sem_mencao: o rotulo vira so o verbo ('Pagar para ')",
    '    texto: `Pagar para outro membro ${daCasa ? `de ${daCasa}` : "do grupo"}`,',
    '    texto: `Pagar para ${daCasa ? "" : ""}`,',
  ],
  [
    LIB,
    "fallback_vira_vazio: sem nome, o rotulo e a string vazia",
    '    texto: `Pagar para outro membro ${daCasa ? `de ${daCasa}` : "do grupo"}`,',
    '    texto: "",',
  ],
  [
    LIB,
    "grupo_ignorado_no_fallback: nunca diz 'de Casa', so 'do grupo'",
    '    texto: `Pagar para outro membro ${daCasa ? `de ${daCasa}` : "do grupo"}`,',
    '    texto: "Pagar para outro membro do grupo",',
  ],
  [
    LIB,
    "nome_em_branco_vira_nome: full_name de espacos passa a nomear a pessoa",
    '  const limpo = (nome ?? "").trim();',
    '  const limpo = nome ?? "";',
  ],
  [
    LIB,
    "temNome_invertido: a marca diz o contrario do texto",
    "    temNome: false,",
    "    temNome: true,",
  ],

  // -------------------------------------------------------------------------
  // A DIVIDA QUE DESAPARECE
  // -------------------------------------------------------------------------
  [
    LIB,
    "ausente_e_null_juntos: a divida SEM DONO sai do painel e fica no «Previsto»",
    "    if (prevista.pagar_para === undefined) continue;",
    "    if (!prevista.pagar_para) continue;",
  ],
  [
    LIB,
    "tudo_entra: a linha pessoal e a que EU fronto passam a ser divida com alguem",
    "    if (prevista.pagar_para === undefined) continue;",
    '    if (prevista.pagar_para === "nunca") continue;',
  ],

  // -------------------------------------------------------------------------
  // A PENEIRA DE STATUS -- a mesma do cartao de cima
  // -------------------------------------------------------------------------
  [
    LIB,
    "sem_peneira_de_status: a conta JA PAGA volta a somar no painel",
    "    if (STATUS_QUE_SAI_DO_PREVISTO.has(String(prevista.status))) continue;",
    '    if (String(prevista.status) === "nunca") continue;',
  ],
  [
    LIB,
    "peneira_invertida: so a conta paga entra, a pendente sai",
    "    if (STATUS_QUE_SAI_DO_PREVISTO.has(String(prevista.status))) continue;",
    "    if (!STATUS_QUE_SAI_DO_PREVISTO.has(String(prevista.status))) continue;",
  ],

  // -------------------------------------------------------------------------
  // A CHAVE DA AGREGACAO
  // -------------------------------------------------------------------------
  [
    LIB,
    "agrupa_por_nome: dois perfis invisiveis viram UMA linha (total certo, destino errado)",
    "    const chave = user_id ?? \"\";",
    '    const chave = nomes.get(user_id ?? "") ?? "sem-nome";',
  ],
  [
    LIB,
    "chave_unica: todo mundo cai no mesmo balde",
    "    const chave = user_id ?? \"\";",
    '    const chave = "um so";',
  ],

  // -------------------------------------------------------------------------
  // A INVARIANTE soma(detalhe) === total
  // -------------------------------------------------------------------------
  [
    LIB,
    "total_nao_soma: o total passa a ser a ULTIMA linha, e o chevron desmente o numero",
    "    destino.total = centavos(destino.total + valor);",
    "    destino.total = valor;",
  ],
  [
    LIB,
    "sem_centavos: a soma acumula erro de ponto flutuante (0,1 + 0,2)",
    "    destino.total = centavos(destino.total + valor);",
    "    destino.total = destino.total + valor;",
  ],
  [
    LIB,
    "valor_cru: o amount do PostgREST entra sem modulo e sem duas casas",
    "    const valor = valorEmReais(prevista.amount);",
    "    const valor = Number(prevista.amount ?? 0);",
  ],

  // -------------------------------------------------------------------------
  // A ORDEM
  // -------------------------------------------------------------------------
  [
    LIB,
    "sem_desempate: duas leituras do mesmo periodo dao telas em ordens diferentes",
    '        b.total - a.total || (a.user_id ?? "").localeCompare(b.user_id ?? "")',
    "        b.total - a.total",
  ],
  [
    LIB,
    "ordem_invertida: o menor total primeiro",
    '        b.total - a.total || (a.user_id ?? "").localeCompare(b.user_id ?? "")',
    '        a.total - b.total || (a.user_id ?? "").localeCompare(b.user_id ?? "")',
  ],

  // -------------------------------------------------------------------------
  // A LINHA DO DETALHE, no contrato da HMO-300
  // -------------------------------------------------------------------------
  [
    LIB,
    "de_grupo_falso: a linha perde o rotulo e a metade do aluguel parece erro de digitacao",
    "      de_grupo: true,",
    "      de_grupo: false,",
  ],
  [
    LIB,
    "posso_editar_true: botao em cima de linha de outro membro (a RLS recusa com 200)",
    "      posso_editar: false,",
    "      posso_editar: true,",
  ],
  [
    LIB,
    "gravada_sempre: a previsao sem id passa por gravada e ganha acao",
    "      gravada: prevista.id != null,",
    "      gravada: true,",
  ],
  [
    LIB,
    "grupo_repetido: o mesmo grupo entra duas vezes na lista de nomes",
    "    if (grupo && !destino.grupos.includes(grupo)) destino.grupos.push(grupo);",
    "    if (grupo) destino.grupos.push(grupo);",
  ],

  // -------------------------------------------------------------------------
  // O CHEVRON, NA TELA
  // -------------------------------------------------------------------------
  [
    TELA,
    "aberto_por_padrao: o painel abre tudo expandido",
    "  const [aberto, setAberto] = useState(false);",
    "  const [aberto, setAberto] = useState(true);",
  ],
  [
    TELA,
    "chevron_nao_fecha: o segundo clique nao desliga",
    "            onClick={() => setAberto((estava) => !estava)}",
    "            onClick={() => setAberto(true)}",
  ],
  [
    TELA,
    "chevron_inerte: o clique nao muda nada",
    "            onClick={() => setAberto((estava) => !estava)}",
    "            onClick={() => setAberto((estava) => estava)}",
  ],
  [
    TELA,
    "aria_expanded_fixo: o leitor de tela nunca sabe que abriu",
    "            aria-expanded={aberto}",
    "            aria-expanded={false}",
  ],
  [
    TELA,
    "id_sem_dono: os dois chevrons passam a controlar o MESMO <ul>",
    "  const id = `pra-quem-pagar-${destino.user_id ?? \"sem-dono\"}`;",
    "  const id = `pra-quem-pagar`;",
  ],
  [
    TELA,
    "lista_sempre_no_dom: a lista fica no DOM fechada (hidden nao tira do textContent)",
    "      {podeAbrir && aberto && (",
    "      {podeAbrir && (",
  ],
  [
    TELA,
    "painel_sempre: quem nao tem grupo ve um painel vazio",
    "  if (destinos.length === 0) return null;",
    "  if (destinos.length === -1) return null;",
  ],
  [
    TELA,
    "total_pela_quantidade: o span do total imprime outro numero do mesmo objeto",
    "          data-total-do-destino={destino.total}",
    "          data-total-do-destino={destino.quantidade}",
  ],
];

const SUITES = ["test:pra-quem-pagar", "test:pra-quem-pagar-na-tela"];

const bloco = criarBlocoDeMutantes({
  rotulo: "pra-quem-pagar",
  suites: SUITES,
});

// A sombra vive em diretorio temporario e a arvore rastreada nunca e mutada. O
// handler de sinal existe so para que nem o diretorio orfao sobre.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// O texto de cada arquivo que algum mutante toca. Lido da arvore de verdade, que
// e o original por construcao: nada mais aqui escreve nela. Montado DEPOIS da
// lista, pelos alvos distintos dela -- `const` multilinha declarada ANTES da
// lista faz o recorte de `mede-ancora-ambigua.mjs` levar a lista inteira e a
// guarda de ancora morrer com a main vermelha para todos.
const original = new Map();
for (const arquivo of new Set(mutantes.map(([alvo]) => alvo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

// CONTROLE POSITIVO: a arvore INTACTA tem de passar nas DUAS suites antes de
// qualquer mutante, e pelo MESMO `rodar` que os mutantes usam -- por isso ele
// pega erro no aparelho (Chromium ausente, .tmp mal montado). Sem ele, uma
// sombra mal montada reprova TODO mutante e o placar sai "N/N mortos" sobre
// zero assercoes executadas.
for (const suite of SUITES) {
  const controle = bloco.rodar("controle", {}, suite);
  if (!controle.verde) {
    console.error(
      `ABORTADO: a arvore INTACTA reprova em ${suite} (${controle.como}).`
    );
    console.error(`  ${controle.saida}`);
    console.error(
      "O placar nao valeria: todo mutante 'morreria' sem ter sido medido."
    );
    process.exit(1);
  }
}
console.log(`controle positivo: a arvore intacta passa em ${SUITES.join(" e ")}\n`);

let sobreviventes = 0;

for (const [alvo, nome, de, para] of mutantes) {
  const antes = original.get(alvo);

  // AS TRES TRAVAS DE ANCORA. `String.replace` troca a PRIMEIRA ocorrencia, e um
  // `de` que aparece duas vezes muta um lugar que o rotulo nao descreve.
  const ocorrencias = antes.split(de).length - 1;
  if (ocorrencias === 0) {
    console.error(`SOBREVIVEU (ancora nao casou) :: ${nome}`);
    console.error(`  o texto buscado nao existe em ${alvo}: ${de}`);
    sobreviventes++;
    continue;
  }
  if (ocorrencias > 1) {
    console.error(`SOBREVIVEU (ancora ambigua) :: ${nome}`);
    console.error(
      `  o texto aparece ${ocorrencias}x em ${alvo} -- o replace muta so a 1a`
    );
    sobreviventes++;
    continue;
  }
  const depois = antes.replace(de, para);
  if (depois === antes) {
    console.error(`SOBREVIVEU (replace nao mudou nada) :: ${nome}`);
    sobreviventes++;
    continue;
  }

  // TODAS as suites, parando na primeira que mata. A ordem e a de SUITES: a
  // barata primeiro, para um mutante de aritmetica nao pagar os ~2s do
  // Chromium.
  let r = null;
  let quemMatou = null;
  for (const suite of SUITES) {
    r = bloco.rodar(nome, { [alvo]: depois }, suite);
    if (!r.verde) {
      quemMatou = suite;
      break;
    }
  }

  if (!quemMatou) {
    console.error(`SOBREVIVEU :: ${nome}`);
    if (r && r.mudouASaida === false) {
      console.error("  (saida compilada identica a da arvore limpa: EQUIVALENTE)");
    }
    sobreviventes++;
  } else {
    // Morrer no tsc tambem e morrer -- mutante que nao compila nao chega em
    // producao --, mas a distincao importa: um erro de tipo nao diz que a SUITE
    // pegou a regra.
    console.log(
      `morreu     :: ${nome}  (${r.como === "tsc" ? "tsc" : "asercao"}, ${quemMatou})`
    );
  }
}

console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mortos`);
process.exit(sobreviventes === 0 ? 0 : 1);
