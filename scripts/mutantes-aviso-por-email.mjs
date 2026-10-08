#!/usr/bin/env node
// Prova de mutacao do canal de e-mail (HMO-183). Cada entrada abaixo estraga
// uma decisao do codigo; a suite tem que ficar VERMELHA em todas. Mutante que
// sobrevive e um trecho que nenhum teste distingue -- ou codigo morto.
//
//   npm run mutantes:aviso-por-email
//
// Dois alvos, porque a feature mora em dois lugares: `lib/services/email.ts`
// decide COMO enviar, e a rota do cron decide PARA QUEM e QUANDO. Mutar so o
// primeiro deixaria de fora o defeito mais caro da feature -- mandar o e-mail
// sobre a lista errada e reenviar o mesmo aviso todo dia.
//
// A ROTA NAO E COMPILADA PELA SUITE, E ISSO E DE PROPOSITO. O tsconfig do teste
// inclui so os dois `lib/services/*.ts`; as quatro assercoes sobre a rota leem
// o TEXTO dela do disco. Por isso o mutante da rota tem de chegar ao arquivo em
// disco -- o que o bloco faz, escrevendo a mutacao na sombra alem de passa-la
// em memoria ao compilador.
//
// POR QUE ISTO NAO ESCREVE MAIS NA ARVORE (HMO-234)
// -------------------------------------------------
// A versao de 02/10 fazia `writeFileSync` em `lib/services/email.ts` e na rota,
// restaurando no `finally`. `scripts/check-mutacao-no-lugar.mjs` -- que nasceu
// depois que o PR deste trabalho travou em conflito -- proibe exatamente isso, e
// com razao: um runner morto no meio (SIGTERM de timeout, job cancelado) deixa
// o mutante COMMITAVEL na arvore, e ja plantou mutante neste repositorio duas
// vezes. `criarBlocoDeMutantes` espelha o repo em /tmp e muta so la; no pior
// caso sobra uma sombra orfa em /tmp.
import { readFileSync } from "node:fs";
import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const SERVICO = "lib/services/email.ts";
const ROTA = "app/api/cron/bill-alerts/route.ts";
const SUITE = "test:aviso-por-email";

const fontes = new Map([
  [SERVICO, readFileSync(SERVICO, "utf8")],
  [ROTA, readFileSync(ROTA, "utf8")],
]);

const mutantes = [
  // -------------------------------------------------------------------------
  // O CASO QUE DA NOME A FEATURE: o desligamento nao pode ser mudo
  // -------------------------------------------------------------------------
  [
    SERVICO,
    "canal desligado passa a se reportar como ligado",
    "    desligado: true,\n    sandbox: false,",
    "    desligado: false,\n    sandbox: false,",
  ],
  [
    SERVICO,
    "canal ligado passa a se reportar como desligado",
    "  const resultado: ResultadoEmail = {\n    enviados: 0,\n    desligado: false,",
    "  const resultado: ResultadoEmail = {\n    enviados: 0,\n    desligado: true,",
  ],
  [
    SERVICO,
    "sem chave o envio segue em frente",
    "  if (!config) return desligado();",
    "  const config2 = config ?? { apiKey: '', remetente: '', sandbox: false };\n  if (!config2) return desligado();",
  ],
  [
    ROTA,
    "o dia ocioso para de dizer se o canal esta ligado",
    "body: { ok: true, avisos: 0, push: 0, email: 0, email_desligado: !configuracaoDeEmail() },",
    "body: { ok: true, avisos: 0, push: 0, email: 0 },",
  ],
  [
    ROTA,
    "o resultado do e-mail some do corpo da resposta",
    "        email_desligado: email.desligado,",
    "",
  ],

  // -------------------------------------------------------------------------
  // O MEIO-TERMO: remetente de teste entrega so para o dono da conta
  // -------------------------------------------------------------------------
  [
    SERVICO,
    "remetente de teste deixa de ser sinalizado",
    "    sandbox: !remetente,",
    "    sandbox: false,",
  ],
  [
    SERVICO,
    "remetente em branco passa por remetente proprio",
    "  const remetente = process.env.EMAIL_FROM?.trim();",
    "  const remetente = process.env.EMAIL_FROM;",
  ],
  [
    SERVICO,
    "remetente proprio e ignorado em favor do de teste",
    "    remetente: remetente || REMETENTE_SANDBOX,",
    "    remetente: REMETENTE_SANDBOX,",
  ],

  // -------------------------------------------------------------------------
  // QUEM RECEBE
  // -------------------------------------------------------------------------
  [
    SERVICO,
    "preferencia ausente passa a significar NAO",
    "    if (querEmail(n.user_id) === false) {",
    "    if (!querEmail(n.user_id)) {",
  ],
  [
    SERVICO,
    "quem desligou o e-mail recebe assim mesmo",
    "    if (querEmail(n.user_id) === false) {\n      recusaram++;\n      continue;\n    }",
    "",
  ],
  [
    SERVICO,
    "recusa e contada como falta de endereco",
    "      recusaram++;\n      continue;",
    "      semEndereco++;\n      continue;",
  ],
  [
    SERVICO,
    "usuario sem endereco some da contagem",
    "      semEndereco++;\n      continue;",
    "      continue;",
  ],
  [
    SERVICO,
    "endereco vazio vira destinatario",
    "    const destino = enderecoDe(n.user_id);\n    if (!destino) {",
    "    const destino = enderecoDe(n.user_id);\n    if (destino === undefined) {",
  ],

  // -------------------------------------------------------------------------
  // O ENVIO
  // -------------------------------------------------------------------------
  [
    SERVICO,
    "resposta de erro do provedor vira sucesso",
    "    if (!resposta.ok) {",
    "    if (false) {",
  ],
  [
    SERVICO,
    "a mensagem do provedor e trocada por um erro generico",
    "      const detalhe = dados?.message || dados?.name || `HTTP ${resposta.status}`;\n      return { ok: false, erro: `${resposta.status}: ${detalhe}` };",
    '      return { ok: false, erro: "falhou" };',
  ],
  [
    SERVICO,
    "o status HTTP some da mensagem de erro",
    "      return { ok: false, erro: `${resposta.status}: ${detalhe}` };",
    "      return { ok: false, erro: `${detalhe}` };",
  ],
  [
    SERVICO,
    "2xx sem id do provedor passa por entrega",
    '    if (!dados?.id) return { ok: false, erro: "provedor aceitou sem devolver id" };',
    "",
  ],
  [
    SERVICO,
    "provedor fora do ar derruba o cron",
    "    const msg = e instanceof Error ? e.message : String(e);\n    return { ok: false, erro: msg };",
    "    throw e;",
  ],
  [
    SERVICO,
    "chave de idempotencia vira fixa -- o 2o aviso do dia some",
    "      `bill-notification-${aviso.id}`",
    '      "bill-notification"',
  ],
  [
    SERVICO,
    "o cabecalho de idempotencia some",
    '        "Idempotency-Key": chaveDeIdempotencia,',
    "",
  ],
  [
    SERVICO,
    "uma falha interrompe os avisos seguintes",
    "      resultado.falhas.push({ id: aviso.id, erro: r.erro ?? \"falha sem mensagem\" });",
    "      resultado.falhas.push({ id: aviso.id, erro: r.erro ?? \"falha sem mensagem\" });\n      break;",
  ],
  [
    SERVICO,
    "o id da mensagem nao e guardado -- fica sem como conferir a entrega",
    "      resultado.entregues.push({ id: aviso.id, messageId: r.id });",
    "",
  ],

  // -------------------------------------------------------------------------
  // O TEXTO
  // -------------------------------------------------------------------------
  [
    SERVICO,
    "o assunto deixa de ser o texto do aviso",
    "    subject: aviso.title,",
    '    subject: "Aviso do PuloDoGato",',
  ],
  [
    SERVICO,
    "o assunto passa a ir escapado",
    "    subject: aviso.title,",
    "    subject: escaparHtml(aviso.title),",
  ],
  [
    SERVICO,
    "o corpo do aviso some do HTML",
    "<p style=\"margin:0 0 24px;font-size:16px;color:#3f3f46\">${b}</p>",
    '<p style="margin:0 0 24px;font-size:16px;color:#3f3f46"></p>',
  ],
  [
    SERVICO,
    "a versao texto some",
    "    text: `${aviso.title}\\n\\n${aviso.body}\\n\\nVer minhas contas: ${url}`,",
    '    text: "",',
  ],
  [SERVICO, "o link para as contas some", "/dashboard/bills`;", "`;"],
  [
    SERVICO,
    "o escape de HTML e desligado",
    "  const t = escaparHtml(aviso.title);\n  const b = escaparHtml(aviso.body);",
    "  const t = aviso.title;\n  const b = aviso.body;",
  ],
  [
    SERVICO,
    "o & deixa de ser escapado primeiro",
    '    .replace(/&/g, "&amp;")\n    .replace(/</g, "&lt;")',
    '    .replace(/</g, "&lt;")\n    .replace(/&/g, "&amp;")',
  ],
  [
    SERVICO,
    "a barra final da URL base deixa de ser cortada",
    '  return bruto.replace(/\\/+$/, "");',
    "  return bruto;",
  ],
  [
    SERVICO,
    "o rodape de como desligar some",
    "Para parar de receber estes avisos por e-mail, desligue a opção em Avisos, dentro do app.",
    "",
  ],

  // -------------------------------------------------------------------------
  // A ROTA: sobre QUE lista o e-mail sai
  // -------------------------------------------------------------------------
  // Este e o mutante mais caro da lista. Trocar `novos` por `lista` compila,
  // passa em todo teste de unidade de email.ts, e reenvia o mesmo aviso todos
  // os dias ate a conta ser paga -- a UNIQUE da 009 nao protege nada aqui,
  // porque ela so governa a GRAVACAO.
  [
    ROTA,
    "o e-mail passa a sair sobre os alertas do dia, nao sobre os recem-gravados",
    "          novos,\n          (u) => prefs.get(u),",
    "          lista.map((a) => ({ id: a.scheduled_transaction_id, user_id: a.user_id, title: '', body: '' })),\n          (u) => prefs.get(u),",
  ],
  // -------------------------------------------------------------------------
  // A GUARDA DO CANAL DESLIGADO
  // -------------------------------------------------------------------------
  [
    ROTA,
    "procura endereco de todo mundo mesmo com o canal desligado",
    "    const emails = canalLigado\n      ? await enderecosDe(",
    "    const emails = true\n      ? await enderecosDe(",
  ],
  [
    ROTA,
    "canal desligado passa a reportar todo mundo como SEM ENDERECO",
    "    const { paraEnviar, recusaram, semEndereco } = canalLigado\n      ? separarDestinatarios(",
    "    const { paraEnviar, recusaram, semEndereco } = true\n      ? separarDestinatarios(",
  ],
];

const bloco = criarBlocoDeMutantes({ rotulo: "aviso-por-email", suites: [SUITE] });

let sobreviventes = 0;
let mortosPorAssercao = 0;
try {
  // CONTROLE POSITIVO. Sem ele, uma sombra incompleta faria TODO mutante
  // "morrer" e o placar sairia cheio sem que uma assercao tivesse medido nada.
  const controle = bloco.rodar("controle", {}, SUITE);
  if (!controle.verde) {
    console.error(
      `CONTROLE FALHOU: a arvore intacta nao passa na suite (${controle.como}) -> ${controle.saida}`,
    );
    console.error("A sombra esta errada. O placar abaixo nao valeria.");
    bloco.fechar();
    process.exit(1);
  }
  console.log("controle: a arvore intacta passa na suite  OK\n");

  for (const [alvo, nome, de, para] of mutantes) {
    const original = fontes.get(alvo);
    const ocorrencias = original.split(de).length - 1;
    if (ocorrencias === 0) {
      // NAO APLICADO conta como sobrevivente de proposito: um mutante que nao
      // casa nao prova nada, e o modo de falha dele e ficar verde para sempre
      // depois de um refactor inocente.
      console.log(`?? NAO APLICADO  [${alvo}] ${nome} -- o trecho nao existe mais`);
      sobreviventes++;
      continue;
    }
    if (ocorrencias > 1) {
      // `String.replace` com string pega SO a primeira ocorrencia: um trecho
      // ambiguo mutaria um lugar que nao e o que o nome do mutante descreve.
      console.log(
        `?? AMBIGUO       [${alvo}] ${nome} -- o trecho aparece ${ocorrencias}x; a mutacao atingiria so a primeira`,
      );
      sobreviventes++;
      continue;
    }

    const r = bloco.rodar(nome, { [alvo]: original.replace(de, para) }, SUITE);
    if (r.verde) {
      console.log(`SOBREVIVEU   [${alvo}] ${nome}`);
      if (r.mudouASaida === false) {
        console.log(
          "             (a saida compilada e identica a da arvore limpa: mutante EQUIVALENTE, nao furo de teste)",
        );
      }
      sobreviventes++;
    } else {
      if (r.como === "teste") mortosPorAssercao++;
      console.log(`morreu       [${alvo}] ${nome}  (${r.como}: ${r.saida})`);
    }
  }
} finally {
  bloco.fechar();
}

const mortos = mutantes.length - sobreviventes;
console.log(
  sobreviventes === 0
    ? `\nTUDO OK -- os ${mutantes.length} mutantes morreram (${mortosPorAssercao} por assercao).`
    : `\n${sobreviventes} de ${mutantes.length} sobreviveram.`,
);

// MUTANTE MORTO SO PELO `tsc` NAO PROVA ASSERCAO NENHUMA. Se todos morressem
// assim, a suite poderia estar vazia e o placar sairia perfeito.
if (mortos > 0 && mortosPorAssercao === 0) {
  console.error(
    "\nNENHUM mutante foi morto por assercao -- todos cairam no compilador. A suite nao esta medindo nada.",
  );
  process.exit(1);
}
process.exit(sobreviventes > 0 ? 1 : 0);
