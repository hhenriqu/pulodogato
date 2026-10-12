#!/usr/bin/env node
// =====================================================
// PULODOGATO - controle negativo do soft delete monotonico (HMO-403)
// =====================================================
//   node scripts/mutantes-soft-delete-monotonico.mjs
//
// POR QUE ESTE RUNNER EXISTE
// --------------------------
// `test:soft-delete-monotonico` passa com 12 casos verdes, e isso sozinho nao
// diz nada: as assercoes que mais importam nele sao de AUSENCIA ("a linha
// `cancelled` continua `cancelled`"), e assercao de ausencia passa verde
// tambem quando ela deixou de medir. Cada entrada abaixo estraga UMA decisao do
// conserto; a suite tem de ficar VERMELHA em todas.
//
// O MUTANTE QUE E O CODIGO DE ANTES DO CONSERTO
// ---------------------------------------------
// `a ancora volta a entrar na lista sem perguntar nada` e o estado anterior,
// letra por letra: `apenas_esta` marca a ancora seja qual for o estado dela. Ele
// e a unica coisa que prova que a medicao ve o defeito que ACONTECEU em
// producao, e nao uma variacao proxima dele.
//
// CADA MUTANTE NOMEIA O ORACULO QUE O MATA, E ISSO NAO E ARRUMACAO
// ----------------------------------------------------------------
// Duas suites medem este conserto, em alturas diferentes, e varios mutantes so
// sao visiveis numa delas:
//
//   `test:soft-delete-monotonico`  chama o route handler e RELE o `status` na
//                                  tabela. E o oraculo do que o banco guarda;
//   `test:alcance-da-serie`        chama a regra pura. E o oraculo do PLANO.
//
// A primeira versao desta lista apontava tudo para a sonda de rota, e sete
// mutantes sobreviveram -- nao por furo de assercao, mas porque a rota tem DUAS
// travas para a mesma coisa (o plano escolhe as linhas, e o `.eq("status",
// "pending")` da escrita confere de novo), e duas guardas que se cobrem fazem
// os dois mutantes sobreviverem. Separar os oraculos e o que da medida a cada
// uma: o mutante que estraga o plano morre na suite do plano mesmo com a
// escrita ainda certa.
//
// A MUTACAO VAI PARA UMA SOMBRA EM /tmp, NUNCA PARA A ARVORE: ver o cabecalho
// de scripts/mutantes-em-bloco.mjs.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const ROTA = "app/api/scheduled-transactions/[id]/route.ts";
const REGRA = "lib/recorrencia-edicao.ts";
const SERVICO = "lib/services/scheduled.ts";
/** O oraculo do que o BANCO guarda: chama a rota e rele o `status`. */
const SONDA_DE_ROTA = "test:soft-delete-monotonico";
/** O oraculo do PLANO: chama a regra pura, sem banco nem rota. */
const SONDA_DO_PLANO = "test:alcance-da-serie";

// OS CAMINHOS SAO RELATIVOS A RAIZ, E LIDOS DIRETO -- SEM HELPER.
//
// A primeira versao disto tinha um `const caminho = (relativo) =>
// fileURLToPath(new URL(...))`, e ele derrubou `check-ancora-de-mutante`: a
// guarda IMPORTA o miolo do runner como modulo de dados, sem os imports dele, e
// uma declaracao que CHAMA funcao estoura ali (`fileURLToPath is not defined`)
// -- a varredura inteira aborta, que e o resultado certo e e caro de ler.
//
// A guarda injeta um `readFileSync` que resolve contra a raiz do repositorio,
// entao a forma que ela sabe ler e esta: `readFileSync(CONSTANTE, "utf8")` com
// a constante guardando o caminho RELATIVO. E a mesma de
// scripts/mutantes-alcance-da-serie.mjs. Ver `MORTAS_SO_PARA_DADOS` em
// scripts/converte-mutantes-em-bloco.mjs para a lista do que ela sabe descartar.
const originais = {
  [ROTA]: readFileSync(ROTA, "utf8"),
  [REGRA]: readFileSync(REGRA, "utf8"),
  [SERVICO]: readFileSync(SERVICO, "utf8"),
};

const MUTANTES = [
  // -------------------------------------------------------------------------
  // O DEFEITO MEDIDO EM PRODUCAO, RECONSTITUIDO
  // -------------------------------------------------------------------------
  {
    nome: "a ancora volta a entrar na lista sem perguntar nada (o defeito da issue)",
    suite: SONDA_DO_PLANO,
    fonte: REGRA,
    porque:
      "o codigo de antes do conserto: 'apenas_esta' marca a ancora seja qual for o estado dela, e a ocorrencia `cancelled` e REESCRITA para `skipped`. Foi medido em 6 linhas de producao -- as seis terminaram `skipped`, com 200 nas seis respostas",
    de: "  const ancoraAvanca = oSoftDeleteAvanca(ancora.status, \"skipped\");",
    para: "  const ancoraAvanca = true;",
  },
  {
    nome: "o filtro de status sai da escrita (a janela entre ler e gravar reabre)",
    suite: SONDA_DE_ROTA,
    fonte: ROTA,
    porque:
      "o plano continua certo e a ESCRITA volta a ser cega: um segundo pedido que deixou a linha `cancelled` entre a leitura e o UPDATE tem o estado dele rebaixado. E a diferenca entre 'o plano nunca rebaixa' e 'a rota nunca rebaixa', e so a segunda vale para quem le o banco depois",
    de: "        .eq(\"status\", \"pending\")\n        .select();",
    para: "        .select();",
  },

  // -------------------------------------------------------------------------
  // A ESCALA: O QUE FAZ `skipped` E `cancelled` NAO SEREM A MESMA COISA
  // -------------------------------------------------------------------------
  {
    nome: "a escala vira um predicado: skipped e cancelled empatam",
    suite: SONDA_DO_PLANO,
    fonte: REGRA,
    porque:
      "`>=` em vez de `>` deixa gravar `skipped` sobre `skipped` -- nao perde estado, mas conta 'pulei 1' num mes que ninguem acabou de pular, e a resposta deixa de ser idempotente",
    de: "  return novo > atual;",
    para: "  return novo >= atual;",
  },
  {
    nome: "a escala e lida ao contrario (so o retrocesso e autorizado)",
    suite: SONDA_DO_PLANO,
    fonte: REGRA,
    porque:
      "o erro de sinal mais facil de escrever. Ele inverte a feature: a `cancelled` seria rebaixada e a `pending` ficaria intacta -- e a `pending` intacta e justamente o que a tela de lista nao mostra como diferenca",
    de: "  return novo > atual;",
    para: "  return novo < atual;",
  },
  {
    nome: "cancelled e skipped ficam a mesma distancia da agenda",
    suite: SONDA_DO_PLANO,
    fonte: REGRA,
    porque:
      "a tabela de distancias e o lugar onde o rebaixamento e definido. Com os dois no mesmo numero, nenhuma escrita entre eles avanca -- o rebaixamento morre, mas o caminho de limpeza (`skipped` -> `cancelled` em `encerrarRegra`) morre junto",
    de: "  skipped: 1,\n  cancelled: 2,",
    para: "  skipped: 2,\n  cancelled: 2,",
  },
  {
    nome: "a paga entra na escala e deixa de ser 409",
    suite: SONDA_DO_PLANO,
    fonte: REGRA,
    porque:
      "parece arrumacao ('faltou um estado na tabela') e troca a resposta de apagar uma conta PAGA: de 409 com a frase do estorno para `skipped` gravado em cima de dinheiro que ja andou",
    de: "const DISTANCIA_DA_AGENDA: Record<string, number> = {\n  pending: 0,",
    para: "const DISTANCIA_DA_AGENDA: Record<string, number> = {\n  paid: 0,\n  pending: 0,",
  },
  {
    nome: "status desconhecido passa a ser tratado como o mais aberto de todos",
    suite: SONDA_DO_PLANO,
    fonte: REGRA,
    porque:
      "fechar por omissao e o lado certo de errar aqui. Com `return true`, um estado novo no enum de amanha -- ou um `paid` que escapasse do 409 -- seria reescrito em vez de preservado",
    de: "  if (atual === undefined || novo === undefined) return false;",
    para: "  if (atual === undefined || novo === undefined) return true;",
  },

  // -------------------------------------------------------------------------
  // A IRMA USA A MESMA PERGUNTA QUE A ANCORA
  // -------------------------------------------------------------------------
  {
    nome: "a irma ja fora da agenda volta a ser remarcada",
    suite: SONDA_DO_PLANO,
    fonte: REGRA,
    porque:
      "a contagem que a tela mostra ('pulei 7') passa a incluir meses que ja estavam fora, e a irma `cancelled` e rebaixada para `skipped` pelo caminho das irmas em vez do da ancora -- o mesmo defeito, por outra porta",
    de: "    if (!oSoftDeleteAvanca(irma.status, \"skipped\")) {",
    para: "    if (false) {",
  },

  // -------------------------------------------------------------------------
  // A ROTA: LISTA VAZIA E SUCESSO, E A REGRA ENCERRA MESMO ASSIM
  // -------------------------------------------------------------------------
  {
    nome: "a lista vazia volta a ser 500",
    suite: SONDA_DE_ROTA,
    fonte: ROTA,
    porque:
      "`.in(\"id\", [])` alcanca zero linha, e sem o `if` a rota responde 'nao foi possivel pular esta conta' sobre uma conta que ja esta exatamente onde o pedido quer. Pedir de novo o que ja esta feito nao e erro",
    de: "    if (plano.idsParaPular.length > 0) {",
    para: "    if (true) {",
  },
  {
    nome: "a rota devolve a linha de uma IRMA quando a ancora nao foi tocada",
    suite: SONDA_DE_ROTA,
    fonte: ROTA,
    porque:
      "`?? puladas[0]` entrega ao cliente, debaixo da chave `scheduled`, o estado de um mes que ele nao pediu como se fosse o do mes que pediu",
    de: "      scheduled: puladas.find((linha) => linha.id === params.id) ?? null,",
    para: "      scheduled: puladas.find((linha) => linha.id === params.id) ?? puladas[0],",
  },
  {
    nome: "a frase afirma ter tirado a ancora que ela preservou",
    suite: SONDA_DE_ROTA,
    fonte: ROTA,
    porque:
      "'Tirei ESTA e as 2 proximas' sobre uma ocorrencia que a rota nao tocou e o pior jeito de responder: confirma a acao que nao houve, e o cliente nao tem como saber",
    de: "    const mensagem = plano.ancoraJaForaDaAgenda",
    para: "    const mensagem = false",
  },
  {
    nome: "a regra deixa de ser encerrada quando a ancora ja estava fora",
    suite: SONDA_DO_PLANO,
    fonte: REGRA,
    porque:
      "o conserto obvio e errado: quem le 'se a ancora ja esta fora, devolve na hora' para o encerramento junto, e a regra continua gerando os meses seguintes -- com 200 na resposta. A conta nao volta amanha, volta alguns MESES depois",
    de: "    encerrarRegraEm: ancora.due_date,\n    ancoraJaForaDaAgenda: !ancoraAvanca,",
    para: "    encerrarRegraEm: ancoraAvanca ? ancora.due_date : null,\n    ancoraJaForaDaAgenda: !ancoraAvanca,",
  },

  // -------------------------------------------------------------------------
  // `encerrarRegra`: O CAMINHO DE LIMPEZA DA LINHA JA PULADA
  // -------------------------------------------------------------------------
  {
    nome: "a linha ja pulada volta a ficar presa em skipped para sempre",
    suite: SONDA_DE_ROTA,
    fonte: SERVICO,
    porque:
      "o estado medido em producao: encerrar uma serie de 6 linhas `skipped` respondia '0 ocorrencia(s) em aberto sairam da agenda' e nao tocava em nenhuma. Nao havia caminho NENHUM no app para mudar isso -- so um DELETE no SQL Editor",
    de: "    .eq(\"status\", \"skipped\")\n    .select(\"id\");",
    para: "    .eq(\"status\", \"nunca-casa\")\n    .select(\"id\");",
  },
  {
    nome: "o encerramento da ja pulada herda a barreira de data da pendente",
    suite: SONDA_DE_ROTA,
    fonte: SERVICO,
    porque:
      "o `gte(hoje)` existe para a conta VENCIDA e nao paga, que e divida real. Um mes que a pessoa ja tirou da agenda nao e divida nenhuma, e sao justamente as linhas ANTIGAS as que ficariam presas para sempre",
    de: "    .eq(\"status\", \"skipped\")\n    .select(\"id\");",
    para: "    .eq(\"status\", \"skipped\")\n    .gte(\"due_date\", \"2100-01-01\")\n    .select(\"id\");",
  },
  {
    nome: "a pendente perde a barreira de data (a vencida em aberto desaparece)",
    suite: SONDA_DE_ROTA,
    fonte: SERVICO,
    porque:
      "o outro lado da assimetria acima. Cancelar a conta que venceu e nao foi paga apagaria da tela um atraso que existe",
    de: "    .gte(\"due_date\", today())\n    .select(\"id\");",
    para: "    .select(\"id\");",
  },
  {
    nome: "as duas contagens viram uma soma",
    suite: SONDA_DE_ROTA,
    fonte: SERVICO,
    porque:
      "a frase passa a prometer que N meses sairam da agenda AGORA quando parte deles ja estava fora -- a mesma inflacao de contagem que `planejarExclusao` recusa. E o `.select()` de um UPDATE unico nao permite separar depois: ele devolve as linhas DEPOIS da escrita, todas `cancelled`",
    de: "    canceladas: canceladas?.length ?? 0,\n    jaEstavamFora: jaEstavamFora?.length ?? 0,",
    para:
      "    canceladas: (canceladas?.length ?? 0) + (jaEstavamFora?.length ?? 0),\n    jaEstavamFora: 0,",
  },
  {
    nome: "o encerramento da ja pulada perde o filtro de usuario",
    suite: SONDA_DE_ROTA,
    fonte: SERVICO,
    porque:
      "a escrita nova e a que nasce sem o recorte. A RLS ainda barraria a linha de outro dono, mas depender dela aqui e depender de uma segunda trava para o que esta funcao promete -- e `rls-com-or-infla-agregado-pessoal` e o historico deste repositorio nesse assunto",
    de: "    .eq(\"user_id\", userId)\n    .eq(\"status\", \"skipped\")",
    para: "    .eq(\"status\", \"skipped\")",
  },
];

// O APARELHO QUE ESTA LISTA EXIGIU, E QUE NAO EXISTIA
// ---------------------------------------------------
// `o filtro de status sai da escrita` e o mutante que nao morria. Ele nao era
// furo de assercao: o plano ja tira do caminho toda linha que nao esta
// `pending`, entao em qualquer fixture estatico a guarda da escrita e redundante
// com a do plano, e as duas guardas que se cobrem fazem os dois mutantes
// sobreviverem.
//
// A unica coisa que da medida a ela e uma linha que muda de estado ENTRE a
// leitura e a escrita da MESMA volta -- a corrida que o filtro existe para
// fechar. A sonda ganhou um gancho para isso (`noMeioDoPedido` em
// scripts/test-soft-delete-monotonico.mjs: o client embrulhado conta os
// `from("scheduled_transactions")` e dispara no segundo, que e o do UPDATE).
//
// Fica anotado porque a tentacao, diante de um sobrevivente assim, e apagar a
// guarda ("nao esta medida") ou o mutante ("nao da para matar"). As duas saidas
// perdem a mesma coisa: a diferenca entre "o plano nunca rebaixa" e "a ROTA
// nunca rebaixa", e so a segunda vale para quem le o banco depois.

const bloco = criarBlocoDeMutantes({
  rotulo: "soft-delete-monotonico",
  suites: [SONDA_DE_ROTA, SONDA_DO_PLANO],
});

process.on("exit", () => bloco.fechar());

// CONTROLE POSITIVO. Sem ele, um pipeline quebrado faria TODO mutante "morrer"
// e o placar sairia cheio sobre zero assercoes executadas.
// Uma por suite: um pipeline quebrado em QUALQUER uma delas faria todo mutante
// daquela suite "morrer", e o placar sairia cheio sobre zero assercoes.
for (const suite of [SONDA_DE_ROTA, SONDA_DO_PLANO]) {
  const controle = bloco.rodar(`controle:${suite}`, originais, suite);
  if (!controle.verde) {
    console.error(
      `CONTROLE FALHOU: as fontes intactas reprovam em ${suite} (${controle.como})`
    );
    console.error(`  ${controle.saida}`);
    process.exit(1);
  }
  console.log(`CTRL  as fontes intactas passam em ${suite}`);
}
console.log("");

let mortos = 0;
let porAssercao = 0;
const sobreviventes = [];

for (const m of MUTANTES) {
  const original = originais[m.fonte];

  // MUTANTE QUE NAO SE APLICA E O PIOR RESULTADO POSSIVEL: contaria como
  // "morreu" sem nunca ter existido.
  const ocorrencias = original.split(m.de).length - 1;
  if (ocorrencias === 0) {
    console.error(`NAO APLICOU: ${m.nome}`);
    console.error(`             o trecho procurado nao esta em ${m.fonte}`);
    sobreviventes.push(`${m.nome} (trecho ausente)`);
    continue;
  }
  if (ocorrencias > 1) {
    console.error(`AMBIGUO: ${m.nome}`);
    console.error(
      `         o trecho aparece ${ocorrencias}x em ${m.fonte}; a mutacao atingiria so a primeira`
    );
    sobreviventes.push(`${m.nome} (ancora ambigua)`);
    continue;
  }

  const r = bloco.rodar(
    m.nome,
    { ...originais, [m.fonte]: original.replace(m.de, m.para) },
    m.suite
  );

  if (!r.verde) {
    mortos++;
    if (r.como !== "tsc") porAssercao++;
    console.log(`MORTO ${m.nome}  (${r.como === "tsc" ? "tsc" : "asercao"}, ${m.suite})`);
  } else {
    console.error(`VIVO  ${m.nome}`);
    console.error(`      ${m.porque}`);
    // Sobreviver emitindo o MESMO byte nao e furo de assercao: e mutante
    // equivalente, e nenhuma assercao o mataria.
    if (r.mudouASaida === false) {
      console.error(
        "      (saida compilada identica a da arvore limpa: EQUIVALENTE, nao furo de teste)"
      );
    }
    sobreviventes.push(m.nome);
  }
}

console.log(`\n${mortos}/${MUTANTES.length} mortos (${porAssercao} por assercao).`);

// UM PLACAR PERFEITO SO PELO COMPILADOR NAO MEDE A SUITE. Se nenhum mutante
// morreu por assercao, o que ficou verde foi o `tsc` -- e a suite pode estar
// vazia.
if (mortos > 0 && porAssercao === 0) {
  console.error(
    "\nNENHUM mutante morreu por assercao: o que reprovou foi o compilador.\n" +
      "A suite nao esta medindo o comportamento, so a forma do codigo."
  );
  process.exit(1);
}

if (sobreviventes.length > 0) {
  console.error("\nSOBREVIVENTES:");
  for (const nome of sobreviventes) console.error(`  - ${nome}`);
  process.exit(1);
}
