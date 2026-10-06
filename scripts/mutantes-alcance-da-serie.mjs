#!/usr/bin/env node
// Mutantes das duas regras de alcance -- HMO-228.
//
//   lib/recorrencia-edicao.ts  a conta fixa (scheduled_transactions)
//   lib/parcelas-edicao.ts     a parcela de cartao (financial_transactions)
//
// POR QUE ISTO EXISTE
// -------------------
// `test:alcance-da-serie` passa com 33 assercoes verdes, e isso sozinho nao diz
// nada: um teste que nunca reprovou nao esta medindo o que a justificativa dele
// afirma. Cada mutante abaixo quebra UMA decisao, e a suite tem de ficar
// vermelha em todos.
//
// OS DOIS MUTANTES QUE DAO NOME A ISSUE sao `todas_barreira_por_data` e
// `parcelas_barreira_por_mes_de_fatura`: os dois trocam uma barreira de STATUS
// por uma barreira de DATA. E a troca que um leitor bem-intencionado faz, porque
// "nunca mude o passado" soa como uma pergunta sobre datas. Ela erra duas vezes
// na mesma linha: deixa de alterar a conta vencida e em aberto (que e justamente
// a que a pessoa escolheu "todas" para corrigir) e deixa passar a conta paga
// ANTECIPADAMENTE, cujo vencimento esta no futuro e cujo dinheiro ja andou.
//
// Nenhum destes mutantes quebra nada em runtime. Todos produzem uma tela de
// aparencia normal, com dinheiro errado dentro.
//
// UMA GUARDA SEM MUTANTE, DE PROPOSITO
// ------------------------------------
// `if (aRepartir <= 0) return null` em `novosValoresDasParcelas` nao tem mutante
// aqui, e isso esta anotado no proprio codigo: as duas guardas seguintes ja
// recusam todo caso que ela recusa, entao qualquer mutante sobre ela seria
// EQUIVALENTE -- ele "morreria" sem provar assercao nenhuma, ou sobreviveria e
// mandaria apagar uma linha que documenta a regra. Um placar cheio de mutantes
// equivalentes e exatamente o que faz uma suite parecer medida sem estar.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e feita em memoria; o `.ts` mutado e escrito numa COPIA da arvore,
// em diretorio temporario, e e de la que o `tsc` compila. Nenhum arquivo de
// `lib/` e tocado em momento nenhum.
//
// O jeito usual -- mutar o arquivo, rodar, restaurar no `finally` -- deixa a
// fonte mutada no disco quando o processo morre no meio, e o placar seguinte
// vira ficcao. Pior neste repositorio: restaurar com `git checkout --` apaga
// edicao nao-commitada do mesmo arquivo, sem aviso.
//
// COMO RODAR
//   npm run mutantes:alcance-da-serie

import { readFileSync } from "node:fs";
import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const RECORRENCIA = "lib/recorrencia-edicao.ts";
const PARCELAS = "lib/parcelas-edicao.ts";

const originais = {
  [RECORRENCIA]: readFileSync(RECORRENCIA, "utf8"),
  [PARCELAS]: readFileSync(PARCELAS, "utf8"),
};

const MUTANTES = [
  // -------------------------------------------------------------------------
  // A CONTA FIXA
  // -------------------------------------------------------------------------
  {
    nome: "todas_barreira_por_data",
    fonte: RECORRENCIA,
    porque:
      "O CONTROLE NEGATIVO DA ISSUE: a barreira de 'todas' deixa de ser o status e passa a ser a data. Erra nos dois sentidos de uma vez -- a conta VENCIDA e em aberto nao e mais corrigida (e e a razao de a pessoa ter escolhido 'todas'), e a conta paga ANTECIPADAMENTE passa a ser reescrita depois de o dinheiro ter andado",
    // ANCORA COM A LINHA DE COMENTARIO ACIMA, de proposito: o mesmo `if` existe
    // em `planejarExclusao` 200 linhas abaixo, e sem o comentario a guarda de
    // ambiguidade deste script reprova o mutante (ela reprovou -- foi assim que
    // isto foi descoberto). Mutar a primeira ocorrencia "porque e a que
    // importa" seria o erro: qual das duas e a primeira depende da ordem das
    // funcoes no arquivo.
    de: '    // a decisao que a criou, e a proxima leitura nao sabe qual das duas vale.\n    if (irma.status !== "pending") {',
    para: '    // a decisao que a criou, e a proxima leitura nao sabe qual das duas vale.\n    if (irma.due_date < ancora.due_date) {',
  },
  {
    nome: "todas_sem_barreira_nenhuma",
    fonte: RECORRENCIA,
    porque:
      "'todas' passa a reescrever o mes PAGO, o PULADO e o CANCELADO: um extrato ja conferido muda de valor, e a ocorrencia que a pessoa tirou da agenda de proposito volta a divergir da decisao que a criou",
    de: '    // a decisao que a criou, e a proxima leitura nao sabe qual das duas vale.\n    if (irma.status !== "pending") {',
    para: "    // a decisao que a criou, e a proxima leitura nao sabe qual das duas vale.\n    if (false) {",
  },
  {
    nome: "todas_herda_a_barreira_de_data",
    fonte: RECORRENCIA,
    porque:
      "'todas' passa a se comportar como 'esta_e_proximas': o item novo do Select nao faz nada, e a pessoa que escolheu 'todas' para corrigir um mes anterior recebe sucesso sem ele ter mudado",
    de: '    if (alcance === "esta_e_proximas" && irma.due_date < ancora.due_date) {',
    para: "    if (irma.due_date < ancora.due_date) {",
  },
  {
    nome: "alcanca_irmas_esquece_todas",
    fonte: RECORRENCIA,
    porque:
      "o `if` que decide buscar a serie no banco volta a ser escrito para DOIS alcances: em 'todas' a rota planeja sobre uma lista VAZIA de irmas e responde 'alterei 1 ocorrencia' -- sucesso, sem erro, sem ter alterado a serie",
    de: '  return alcance !== "apenas_esta";',
    para: '  return alcance === "esta_e_proximas";',
  },
  {
    nome: "conferir_patch_libera_todas",
    fonte: RECORRENCIA,
    porque:
      "a conferencia do patch volta a valer so para 'esta_e_proximas': mudar `due_date` em 'todas' poe a serie inteira vencendo no mesmo dia e colide no indice unico (rule_id, due_date) da 005 -- DEPOIS de o UPDATE ja ter passado em algumas linhas",
    de: "  if (!alcancaIrmas(alcance)) return { ok: true };",
    para: '  if (alcance !== "esta_e_proximas") return { ok: true };',
  },
  {
    nome: "todas_nao_atualiza_a_regra",
    fonte: RECORRENCIA,
    porque:
      "as ocorrencias mudam e a regra fica com o valor velho: a proxima geracao traz o valor antigo de volta no primeiro mes que a agenda ainda nao tinha criado, e ninguem liga aquele reaparecimento a esta edicao",
    de: "    atualizarRegra: true,\n    ancoraEm: ancora.due_date,\n    preservadas,\n  };\n}",
    para: "    atualizarRegra: false,\n    ancoraEm: ancora.due_date,\n    preservadas,\n  };\n}",
  },
  {
    nome: "exclusao_sem_end_date",
    fonte: RECORRENCIA,
    porque:
      "A SEGUNDA PROVA EXIGIDA PELA ISSUE: apagar 'esta e as proximas' marca as linhas `skipped` e NAO encerra a regra. Isso protege so o horizonte ja materializado -- `materializarAgenda` roda sobre uma janela rolante e a regra continua `is_active`, entao a conta apagada volta alguns MESES depois, quando ninguem mais liga uma coisa a outra",
    de: "    encerrarRegraEm: ancora.due_date,",
    para: "    encerrarRegraEm: null,",
  },
  {
    nome: "exclusao_so_a_ancora",
    fonte: RECORRENCIA,
    porque:
      "o defeito que esta em producao hoje: 'esta e as proximas' pula so a linha clicada. Quem apaga a conta fixa perde UM mes e recebe os outros de volta",
    de: "    idsParaPular: [ancora.id, ...alcancadas],",
    para: "    idsParaPular: [ancora.id],",
  },
  {
    nome: "exclusao_todas_cresce_caminho_proprio",
    fonte: RECORRENCIA,
    porque:
      "'todas' para de delegar e marca linha por linha: nasce um SEGUNDO lugar que encerra uma regra, e os dois divergem no primeiro conserto que so um deles receber. E este nao desativa a regra, entao a serie inteira volta na proxima geracao",
    de: '  if (alcance === "todas") return { ...base, desativarRegra: true };',
    para: '  if (alcance === "todas") return { ...base, idsParaPular: [ancora.id] };',
  },
  {
    nome: "exclusao_avulsa_vira_skipped",
    fonte: RECORRENCIA,
    porque:
      "a conta avulsa deixa de ser apagada e so vira `skipped`: ela continua na tabela, e quem pediu para excluir ve a linha desaparecer da lista aberta e reaparecer em qualquer filtro que inclua pulados",
    de: "  if (!ancora.recurring_rule_id) return { ...base, apagarDeVez: true };",
    para: "  if (!ancora.recurring_rule_id) return { ...base, idsParaPular: [ancora.id] };",
  },

  // -------------------------------------------------------------------------
  // A PARCELA DE CARTAO
  // -------------------------------------------------------------------------
  {
    nome: "parcelas_barreira_por_mes_de_fatura",
    fonte: PARCELAS,
    porque:
      "O CONTROLE NEGATIVO DA SERIE: a barreira de ordem deixa de ser o NUMERO e passa a ser o mes da fatura. Duas parcelas podem cair no mesmo mes (compra perto do fechamento), e ai 'desta em diante' ancorado na parcela 4 passa a alterar tambem a 3 -- uma parcela ANTERIOR, que a pessoa nao pediu para mexer",
    de: "      irma.installment_number < ancora.installment_number",
    para: '      String(irma.invoice_month) < String(ancora.invoice_month)',
  },
  {
    nome: "parcelas_barreira_por_mes_inclusiva",
    fonte: PARCELAS,
    porque:
      "a mesma troca, na forma `<=`: agora 'desta em diante' ancorado na parcela 3 deixa de fora a 4, que cai no mesmo mes de fatura. A pessoa pede 'desta em diante' e uma das parcelas seguintes nao muda, sem nada na tela dizer qual",
    de: "      irma.installment_number < ancora.installment_number",
    para: '      String(irma.invoice_month) <= String(ancora.invoice_month)',
  },
  {
    nome: "parcelas_todas_herda_a_barreira_de_ordem",
    fonte: PARCELAS,
    porque:
      "'todas' passa a nao alcancar as parcelas anteriores a ancora: ele fica identico a 'desta em diante', e o total da compra nunca fecha no numero que a pessoa digitou",
    de: '      alcance === "esta_e_proximas" &&\n      irma.installment_number < ancora.installment_number',
    para: "      irma.installment_number < ancora.installment_number",
  },
  {
    nome: "parcelas_fatura_paga_ignorada",
    fonte: PARCELAS,
    porque:
      "a parcela que cai numa fatura JA PAGA passa a ser reescrita: um mes de cartao que a pessoa conferiu e quitou muda de valor, e a conciliacao com o extrato do banco deixa de fechar",
    de: "    if (irma.invoice_month !== null && pagas.has(irma.invoice_month)) {",
    para: "    if (false) {",
  },
  {
    nome: "parcelas_nulo_tratado_como_pago",
    fonte: PARCELAS,
    porque:
      "`invoice_month` nulo passa a contar como fatura paga: numa serie onde a view nao resolveu o mes, 'todas' nao altera NADA e responde sucesso -- tratar o desconhecido como protegido e o jeito de nao fazer nada sem avisar",
    de: "    if (irma.invoice_month !== null && pagas.has(irma.invoice_month)) {",
    para: "    if (irma.invoice_month === null || pagas.has(irma.invoice_month)) {",
  },
  {
    nome: "parcelas_preservadas_nao_separadas",
    fonte: PARCELAS,
    porque:
      "a parcela que ficou de fora por FATURA PAGA deixa de ser contada em separado: a tela passa a dizer so 'as 2 anteriores nao mudam', e a pessoa ve o total da compra parar num numero que ela nao calculou sem ter como descobrir por que",
    de: "      plano.preservadasPorFaturaPaga.push(irma.id);",
    para: "      // mutante: sem contar em separado",
  },
  {
    nome: "total_soma_cru_sem_modulo",
    fonte: PARCELAS,
    porque:
      "o total da compra passa a somar `amount` cru: a despesa esta gravada NEGATIVA, entao a tela imprime '-R$ 3.000,00 de total da compra' -- e no calculo do total recalculado o sinal invertido faz a conta andar para o lado errado",
    de: "  const centavos = parcelas.reduce(\n    (soma, p) => soma + Math.abs(Math.round(p.amount * 100)),\n    0\n  );",
    para: "  const centavos = parcelas.reduce(\n    (soma, p) => soma + Math.round(p.amount * 100),\n    0\n  );",
  },
  {
    nome: "preservadas_fora_do_total",
    fonte: PARCELAS,
    porque:
      "em base 'total' o numero digitado passa a ser repartido INTEIRO entre as alcancadas, ignorando o que as preservadas ja valem: a pessoa digita 'total da compra = 2.600' e o banco fica com 3.200",
    de: "    aRepartir = digitado - preservadoEmCentavos;",
    para: "    aRepartir = digitado;",
  },
  {
    nome: "sobra_de_centavo_perdida",
    fonte: PARCELAS,
    porque:
      "a ultima parcela deixa de fechar o total: R$ 100 em 3 vira tres de 33,33 e a compra passa a somar 99,99. E sempre o mesmo centavo, em toda compra dividida que nao fecha, e ele nunca aparece como erro",
    de: "  const ultima = aRepartir - porParcela * (quantas - 1);",
    para: "  const ultima = porParcela;",
  },
  {
    nome: "parcela_zerada_aceita",
    fonte: PARCELAS,
    porque:
      "R$ 0,01 repartido em 8 parcelas grava SETE linhas com `amount = 0`, e `financial_transactions` tem CHECK `amount <> 0`: o UPDATE morre no meio da serie, com algumas parcelas ja alteradas e nenhuma transacao envolvendo tudo",
    de: "  if (porParcela <= 0) return null;",
    para: "  if (false) return null;",
  },
  {
    nome: "ultima_parcela_com_sinal_invertido",
    fonte: PARCELAS,
    porque:
      "R$ 0,05 em 8 parcelas da sete de 1 centavo e uma ULTIMA de -2: com o sinal da despesa aplicado ela vira um numero POSITIVO no meio de oito negativos, ou seja um credito no cartao. O banco aceita e a fatura daquele mes abate em vez de cobrar",
    de: "  if (ultima <= 0) return null;",
    para: "  if (false) return null;",
  },
  {
    nome: "despesa_gravada_positiva",
    fonte: PARCELAS,
    porque:
      "a parcela alterada passa a ser gravada POSITIVA: a compra parcelada vira RECEITA, soma no realizado do mes em vez de abater, e a fatura do cartao abate pelo valor da parcela",
    de: "    amount: -((i === quantas - 1 ? ultima : porParcela) / 100),",
    para: "    amount: (i === quantas - 1 ? ultima : porParcela) / 100,",
  },
  {
    nome: "consequencia_sem_o_total_de_antes",
    fonte: PARCELAS,
    porque:
      "a frase da tela passa a dizer so o total NOVO: 'o total da compra passa a ser R$ 2.600,00' sozinho nao diz se era isso que a pessoa esperava, e e justamente nessa comparacao que ela descobre que escolheu o alcance errado",
    de: "        ? `Muda da parcela ${plano.ancoraEm} em diante. As ${anteriores} anteriores ficam com o valor antigo, então o total da compra passa a ser ${emReais(total.depois)} (era ${emReais(total.antes)}).`",
    para: "        ? `Muda da parcela ${plano.ancoraEm} em diante. O total da compra passa a ser ${emReais(total.depois)}.`",
  },
];

// O BLOCO: um diretorio, um processo, a fonte e 23 mutantes dentro (HMO-319).
//
// Antes cada volta montava uma arvore nova em diretorio temporario -- a fonte
// mutada mais a lista de arquivos que a acompanham -- e chamava o `tsc`. Era o
// programa INTEIRO reparseado por mutante, para trocar um arquivo.
//
// Agora a compilacao e em processo e todas as voltas dividem o AST ja parseado
// de tudo que nao e o arquivo mutado. E as etapas vem do proprio alvo
// `test:alcance-da-serie` no package.json, em vez de repetidas a mao aqui: a copia da
// receita divergia do alvo de verdade sem nada reclamar.
//
// A LISTA DE ARQUIVOS QUE ACOMPANHAM DEIXOU DE EXISTIR, e e por isso que cinco
// blocos deste repositorio pararam de reprovar na main: a compilacao le a arvore
// de verdade e troca em memoria so o arquivo mutado, entao nao ha mais uma
// segunda copia do grafo de modulos para envelhecer em silencio. Quem delimita o
// que este bloco prova continua sendo o tsconfig da suite.
const SUITE_DO_BLOCO = "test:alcance-da-serie";
const bloco = criarBlocoDeMutantes({ rotulo: "alcance-da-serie", suites: [SUITE_DO_BLOCO] });

/** Adapta a chamada antiga `rodar(nome, fontes)` ao bloco. */
const voltaDoBloco = (nome, fontes) => bloco.rodar(nome, fontes ?? {}, SUITE_DO_BLOCO);


let falhou = false;

try {
  // CONTROLE POSITIVO. Sem ele, uma copia de arvore incompleta faria TODO
  // mutante "morrer" e o placar sairia cheio sem que uma assercao tivesse
  // medido nada.
  const controle = voltaDoBloco("controle", originais);
  if (!controle.verde) {
    console.error(
      `CONTROLE FALHOU: as fontes intactas nao passam na suite (${controle.como}) -> ${controle.saida}`
    );
    console.error("A copia da arvore esta errada. O placar abaixo nao vale.");
    bloco.fechar();
    process.exit(1);
  }
  console.log("controle: as fontes intactas passam na suite  OK\n");

  let mortos = 0;
  let porTeste = 0;

  for (const m of MUTANTES) {
    const original = originais[m.fonte];

    // MUTANTE QUE NAO SE APLICA E O PIOR RESULTADO POSSIVEL: ele contaria como
    // "morreu" sem nunca ter existido.
    const ocorrencias = original.split(m.de).length - 1;
    if (ocorrencias === 0) {
      console.error(
        `NAO APLICOU: ${m.nome} -- o trecho procurado nao esta em ${m.fonte}`
      );
      falhou = true;
      continue;
    }
    if (ocorrencias > 1) {
      console.error(
        `AMBIGUO: ${m.nome} -- o trecho aparece ${ocorrencias}x em ${m.fonte}; a mutacao atingiria so a primeira`
      );
      falhou = true;
      continue;
    }

    const r = voltaDoBloco(m.nome, {
      ...originais,
      [m.fonte]: original.replace(m.de, m.para),
    });

    if (r.verde) {
      console.error(`SOBREVIVEU: ${m.nome}`);
      console.error(`            ${m.porque}`);
      // Sobreviver emitindo o MESMO byte nao e furo de assercao: e mutante
      // equivalente, e nenhuma assercao o mataria.
      if (r.mudouASaida === false) {
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
