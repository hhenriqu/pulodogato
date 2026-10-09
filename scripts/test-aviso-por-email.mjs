// =====================================================
// TESTES - AVISO DE VENCIMENTO POR E-MAIL (HMO-183)
// =====================================================
//   npm run test:aviso-por-email
//
// O que esta suite protege, em uma frase: que o canal de e-mail nunca fique
// desligado EM SILENCIO.
//
// O resto do arquivo e detalhe. O push ficou meses sem entregar nada em
// producao porque `chavesVapid()` devolve null sem as variaveis e o cron
// responde 200 do mesmo jeito -- um canal morto e um canal funcionando sao
// indistinguiveis de fora. O e-mail copia esse padrao de proposito (uma
// variavel de ambiente opcional nao pode derrubar os avisos que ja funcionam),
// entao copia junto o modo de falha. A defesa e `desligado` subir ate o corpo
// da resposta, que o livro-razao da 019 grava em `cron_runs`.
//
// O QUE ESTA SUITE NAO PROVA
// --------------------------
// Entrega. `fetch` e dublado aqui. Que o Resend aceitou a mensagem E que ela
// chegou numa caixa de entrada so se prova no painel do provedor, com o
// `email_message_id` que a rota grava em `bill_notifications`.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  configuracaoDeEmail,
  montarEmailDoAviso,
  escaparHtml,
  separarDestinatarios,
  enviarEmails,
  REMETENTE_SANDBOX,
} = await import("../.tmp-aviso-por-email/services/email.js");

const { textoDoAviso } = await import("../.tmp-aviso-por-email/services/notifications.js");

// ---------------------------------------------------------------------------
// Utilitarios
// ---------------------------------------------------------------------------

/** Roda `fn` com as variaveis de ambiente dadas e devolve tudo como estava. */
async function comAmbiente(vars, fn) {
  const antes = {};
  for (const [k, v] of Object.entries(vars)) {
    antes[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Substitui globalThis.fetch por um dublê que registra as chamadas. */
async function comFetch(responder, fn) {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, init) => {
    chamadas.push({ url, init });
    return responder(chamadas.length, { url, init });
  };
  try {
    await fn(chamadas);
  } finally {
    globalThis.fetch = original;
  }
  return chamadas;
}

/** Uma resposta de sucesso do Resend. */
function aceito(id) {
  return { ok: true, status: 200, json: async () => ({ id }) };
}

const ALERTA = {
  scheduled_transaction_id: "s1",
  user_id: "u1",
  description: "Aluguel",
  amount: -1850.5,
  due_date: "2026-10-02",
  days_until: 1,
  kind: "due_soon",
  transaction_type: "expense",
  already_notified: false,
};

// ---------------------------------------------------------------------------
// O CASO QUE DA NOME AO ARQUIVO: o desligamento nao pode ser mudo
// ---------------------------------------------------------------------------

test("sem RESEND_API_KEY a configuracao e null -- o canal fica desligado", async () => {
  await comAmbiente({ RESEND_API_KEY: undefined }, () => {
    assert.equal(configuracaoDeEmail(), null);
  });
});

test("desligado, enviarEmails NAO lanca e NAO derruba o cron", async () => {
  await comAmbiente({ RESEND_API_KEY: undefined }, async () => {
    const r = await enviarEmails([
      { id: "n1", destino: "a@b.com", title: "Aluguel vence amanhã", body: "R$ 1.850,50" },
    ]);
    assert.equal(r.enviados, 0);
    assert.equal(r.desligado, true);
  });
});

test("desligado NAO tenta falar com o provedor", async () => {
  await comAmbiente({ RESEND_API_KEY: undefined }, async () => {
    const chamadas = await comFetch(
      () => {
        throw new Error("nao deveria ter chamado o provedor");
      },
      async () => {
        await enviarEmails([{ id: "n1", destino: "a@b.com", title: "t", body: "b" }]);
      }
    );
    assert.equal(chamadas.length, 0);
  });
});

test("o desligamento e DISTINGUIVEL de um dia sem nada a avisar", async () => {
  // Esta e a assercao que paga a suite inteira. Os dois casos produzem
  // `enviados: 0`, e e so `desligado` que os separa -- sem ele, o campo que vai
  // para `cron_runs` nao responde a unica pergunta que importa no dia em que
  // alguem for investigar por que ninguem recebeu e-mail.
  const semChave = await comAmbiente({ RESEND_API_KEY: undefined }, () => enviarEmails([]));

  const comChaveSemAvisos = await comAmbiente(
    { RESEND_API_KEY: "re_teste", EMAIL_FROM: "PuloDoGato <avisos@exemplo.com>" },
    () => enviarEmails([])
  );

  assert.equal(semChave.enviados, 0);
  assert.equal(comChaveSemAvisos.enviados, 0);
  assert.notEqual(
    semChave.desligado,
    comChaveSemAvisos.desligado,
    "canal desligado e canal ocioso tem que ser distinguiveis no resultado"
  );
  assert.equal(semChave.desligado, true);
  assert.equal(comChaveSemAvisos.desligado, false);
});

// ---------------------------------------------------------------------------
// O MEIO-TERMO: ligado, mas entregando so para o dono da conta
// ---------------------------------------------------------------------------

test("com a chave e sem EMAIL_FROM, o remetente e o de teste e `sandbox` avisa", async () => {
  await comAmbiente({ RESEND_API_KEY: "re_teste", EMAIL_FROM: undefined }, () => {
    const c = configuracaoDeEmail();
    assert.equal(c.remetente, REMETENTE_SANDBOX);
    // Sem esta flag o estado "ligado, mas so o dono da conta recebe" seria tao
    // invisivel quanto o canal desligado -- e mais caro, porque parece que
    // funciona.
    assert.equal(c.sandbox, true);
  });
});

test("com EMAIL_FROM proprio, `sandbox` e false", async () => {
  await comAmbiente(
    { RESEND_API_KEY: "re_teste", EMAIL_FROM: "PuloDoGato <avisos@pulodogato.hmoraes.com.br>" },
    () => {
      const c = configuracaoDeEmail();
      assert.equal(c.remetente, "PuloDoGato <avisos@pulodogato.hmoraes.com.br>");
      assert.equal(c.sandbox, false);
    }
  );
});

test("EMAIL_FROM so com espacos conta como ausente", async () => {
  await comAmbiente({ RESEND_API_KEY: "re_teste", EMAIL_FROM: "   " }, () => {
    const c = configuracaoDeEmail();
    assert.equal(c.remetente, REMETENTE_SANDBOX);
    assert.equal(c.sandbox, true, "remetente em branco nao pode passar por remetente proprio");
  });
});

// ---------------------------------------------------------------------------
// UMA DEFINICAO DE TEXTO PARA OS DOIS CANAIS
// ---------------------------------------------------------------------------

test("o e-mail usa o MESMO texto que o push", () => {
  const { title, body } = textoDoAviso(ALERTA);
  const email = montarEmailDoAviso({ title, body });

  assert.equal(email.subject, title, "o assunto e o title do aviso, sem reescrita");
  assert.ok(email.text.includes(title));
  assert.ok(email.text.includes(body));
  assert.ok(email.html.includes(title));
  assert.ok(email.html.includes(body));
});

test("o texto do aviso continua respeitando o singular -- nos dois canais", () => {
  // "vence em 1 dias" no aviso mais importante (o da vespera) e o detalhe que
  // faz o app inteiro parecer descuidado. A regra mora em textoDoAviso; esta
  // assercao existe para que o e-mail nao ganhe uma copia dela.
  const email = montarEmailDoAviso(textoDoAviso({ ...ALERTA, days_until: 1 }));
  assert.ok(email.subject.includes("amanhã"));
  assert.ok(!email.subject.includes("1 dias"));
});

test("o e-mail leva versao texto E versao html", () => {
  const email = montarEmailDoAviso({ title: "Aluguel vence amanhã", body: "R$ 1.850,50" });
  // Cliente sem HTML e filtro de spam leem a versao texto; so-HTML pontua pior
  // nos dois.
  assert.ok(email.text.length > 0);
  assert.ok(email.html.includes("<html"));
});

test("o e-mail leva um link para as contas", () => {
  const email = montarEmailDoAviso({ title: "t", body: "b" });
  assert.ok(email.html.includes("/dashboard/bills"), "sem link o aviso nao leva a lugar nenhum");
  assert.ok(email.text.includes("/dashboard/bills"));
});

test("o link usa NEXT_PUBLIC_APP_URL quando existe, sem barra dobrada", async () => {
  await comAmbiente({ NEXT_PUBLIC_APP_URL: "https://exemplo.test/" }, () => {
    const email = montarEmailDoAviso({ title: "t", body: "b" });
    assert.ok(email.text.includes("https://exemplo.test/dashboard/bills"));
    assert.ok(!email.text.includes("exemplo.test//dashboard"));
  });
});

test("o rodape diz como desligar o canal", () => {
  // Um aviso recorrente sem saida visivel e o caminho mais curto entre
  // "lembrete util" e "marcar como spam" -- e o dominio inteiro vai junto.
  const email = montarEmailDoAviso({ title: "t", body: "b" });
  assert.ok(/desligue/i.test(email.html));
});

// ---------------------------------------------------------------------------
// A DIRECAO DA FRASE (HMO-350)
// ---------------------------------------------------------------------------
// `textoDoAviso` declarava `transaction_type` na interface `BillAlert` e NUNCA
// o lia: toda frase era de conta a pagar. Medido em producao em 09/10/2026,
// texto literal que o servidor devolveu:
//
//     Bonus (previsto) vence em 20 dias          -- R$ 50,00, RECEITA
//     Aluguel recebido (fixa) vence em 16 dias   -- R$ 2.000,00, RECEITA
//
// O conserto da view (050) sozinho nao mudava nada disso, porque a coluna nao
// tinha leitor. As assercoes abaixo sao o leitor.
//
// Elas vivem NESTE arquivo de proposito: e a suite que ja tem `textoDoAviso` e
// `montarEmailDoAviso` no mesmo processo, e e o canal de E-MAIL que torna o
// defeito caro -- com a 047 colada, a frase errada sai na caixa de entrada
// cobrando o usuario por dinheiro que ele vai RECEBER.

const RECEITA = { ...ALERTA, description: "Bônus", transaction_type: "income", amount: 50 };

/**
 * O valor como `formatarBRL` o escreve, com o ESPACO QUE NAO QUEBRA.
 *
 * `Intl.NumberFormat("pt-BR", { currency: "BRL" })` separa "R$" do numero com
 * U+00A0, nao com um espaco comum -- medido. Uma assercao escrita com espaco
 * normal nunca casa, e a mensagem de erro imprime as duas strings IDENTICAS na
 * tela ("esperado R$ 50,00, obtido R$ 50,00"), o que manda procurar o defeito
 * em qualquer outro lugar. Por isso o caractere e nomeado aqui uma vez, em vez
 * de ser colado invisivel em cada assercao.
 */
const RS = (texto) => `R$\u00A0${texto}`;

test("receita prevista ENTRA, e nao vence", () => {
  const { title } = textoDoAviso({ ...RECEITA, days_until: 20 });
  assert.equal(title, "Bônus entra em 20 dias");
  assert.ok(!/vence/.test(title), "receita anunciada como conta vencendo e o defeito da HMO-350");
});

test("despesa prevista continua vencendo -- o caso que acertava por acaso", () => {
  // A maioria das linhas de producao. Um conserto que inverta ESTE caso troca
  // um defeito pequeno por um grande, e sem esta assercao nada o pegaria.
  const { title } = textoDoAviso({ ...ALERTA, days_until: 20 });
  assert.equal(title, "Aluguel vence em 20 dias");
});

test("receita VENCIDA nao vira cobranca", () => {
  // O pior caso da issue: `kind = 'overdue'` gerava "está vencida -- venceu há
  // N dias" sobre dinheiro a receber.
  const { title, body } = textoDoAviso({ ...RECEITA, kind: "overdue", days_until: -4 });
  assert.equal(title, "Bônus não entrou");
  assert.equal(body, RS("50,00 — era para entrar há 4 dias."));
  assert.ok(
    !/venc/.test(title + body),
    "uma receita atrasada nao venceu, nao e devida e nao e cobranca"
  );
});

test("despesa vencida continua dizendo que venceu", () => {
  const { title, body } = textoDoAviso({ ...ALERTA, kind: "overdue", days_until: -4 });
  assert.equal(title, "Aluguel está vencida");
  assert.equal(body, RS("1.850,50 — venceu há 4 dias."));
});

test("o singular vale para receita tambem -- ontem, hoje e amanha", () => {
  // A regra que o resto deste arquivo ja protege para despesa: "em 1 dias" e
  // "há 1 dias" fazem o app parecer quebrado no aviso mais importante. Uma
  // ramificacao nova e exatamente onde essa regra se perde.
  assert.equal(textoDoAviso({ ...RECEITA, days_until: 1 }).title, "Bônus entra amanhã");
  assert.equal(textoDoAviso({ ...RECEITA, days_until: 0 }).title, "Bônus entra hoje");
  assert.equal(
    textoDoAviso({ ...RECEITA, kind: "overdue", days_until: -1 }).body,
    RS("50,00 — era para entrar ontem.")
  );
});

test("o valor da receita e formatado igual, e sem sinal", () => {
  // `formatarBRL` usa Math.abs: previsto e realizado tem sinais opostos no
  // banco, e a frase nunca mostra "-R$".
  assert.equal(textoDoAviso({ ...RECEITA, amount: -50 }).body, RS("50,00"));
  assert.equal(textoDoAviso({ ...RECEITA, amount: "50" }).body, RS("50,00"));
});

test("transferencia prevista usa a frase de SAIDA -- criterio explicito, nao default", () => {
  // Medido em producao: a "Transferência recorrente para o PIX" de R$ 100,00
  // sai como "vence em 18 dias". Isso FICA: o dinheiro sai mesmo da conta de
  // origem na data, e inverter a frase anunciaria a perna errada. O que esta
  // assercao compra e que a escolha seja MEDIDA -- se um dia `transfer` ganhar
  // frase propria, o vermelho aparece aqui, e nao numa caixa de entrada.
  const t = textoDoAviso({ ...ALERTA, transaction_type: "transfer", days_until: 18 });
  assert.equal(t.title, "Aluguel vence em 18 dias");
  assert.ok(!/entra/.test(t.title), "transferencia nao ENTRA na conta de origem");
});

test("tipo ausente cai no lado de saida -- a view velha nao quebra o app novo", () => {
  // Entre o deploy e a colagem da 050, `bill_alerts` responde pelo tipo da
  // REGRA. O app novo lendo aquela view tem que se comportar como o app velho,
  // nao escolher um lado novo por acidente.
  const semTipo = { ...ALERTA };
  delete semTipo.transaction_type;
  assert.equal(textoDoAviso({ ...semTipo, days_until: 20 }).title, "Aluguel vence em 20 dias");
});

test("o E-MAIL da receita nao cobra nada -- assunto, texto e html", () => {
  // A ponta que a issue existe para fechar: a frase atravessa
  // `montarEmailDoAviso` sem passar por nenhuma segunda formatacao, entao o
  // conserto em `textoDoAviso` vale para os tres canais de uma vez.
  const email = montarEmailDoAviso(textoDoAviso({ ...RECEITA, kind: "overdue", days_until: -4 }));

  // Nenhuma das tres partes pode cobrar. O assunto e o `title` sozinho, entao
  // "era para entrar" (que mora no `body`) e cobrado so do texto e do html --
  // exigir a frase inteira no assunto passaria a medir o formato do e-mail em
  // vez da direcao do aviso.
  assert.equal(email.subject, "Bônus não entrou");
  for (const [onde, conteudo] of [
    ["assunto", email.subject],
    ["texto", email.text],
    ["html", email.html],
  ]) {
    assert.ok(!/venc/i.test(conteudo), `o ${onde} do e-mail ainda cobra uma receita`);
  }
  for (const [onde, conteudo] of [
    ["texto", email.text],
    ["html", email.html],
  ]) {
    assert.ok(
      conteudo.includes("era para entrar há 4 dias"),
      `o ${onde} do e-mail perdeu a frase de receita`
    );
  }
});

// ---------------------------------------------------------------------------
// ESCAPE: o nome da conta vem do usuario
// ---------------------------------------------------------------------------

test("caractere especial no nome da conta nao quebra o HTML", () => {
  const email = montarEmailDoAviso(
    textoDoAviso({ ...ALERTA, description: "Aluguel & <Nubank>" })
  );
  assert.ok(email.html.includes("Aluguel &amp; &lt;Nubank&gt;"));
  assert.ok(
    !email.html.includes("<Nubank>"),
    "um < cru come o resto da frase no cliente de e-mail"
  );
});

test("o ASSUNTO nao e escapado -- cabecalho de e-mail nao e HTML", () => {
  // Escapar aqui faria "Aluguel &amp; condominio" chegar literalmente assim na
  // caixa de entrada. O erro e visivel, mas so para quem recebe.
  const email = montarEmailDoAviso(textoDoAviso({ ...ALERTA, description: "Luz & Água" }));
  assert.ok(email.subject.includes("Luz & Água"));
  assert.ok(!email.subject.includes("&amp;"));
});

test("escaparHtml cobre os cinco caracteres, e o & primeiro", () => {
  // Se o & nao for o primeiro, "&lt;" vira "&amp;lt;" e o texto chega com a
  // entidade visivel.
  assert.equal(escaparHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});

// ---------------------------------------------------------------------------
// QUEM RECEBE
// ---------------------------------------------------------------------------

const NOVOS = [
  { id: "n1", user_id: "u1", title: "Aluguel vence amanhã", body: "R$ 1.850,50" },
  { id: "n2", user_id: "u2", title: "Luz vence hoje", body: "R$ 210,00" },
];

test("quem desligou o e-mail nao recebe", () => {
  const r = separarDestinatarios(
    NOVOS,
    (u) => u !== "u2",
    () => "qualquer@exemplo.com"
  );
  assert.deepEqual(
    r.paraEnviar.map((a) => a.id),
    ["n1"]
  );
  assert.equal(r.recusaram, 1);
});

test("preferencia AUSENTE vale `sim` -- o mesmo COALESCE da view", () => {
  // Entre o deploy do app e a colagem da 047 a view nao devolve a coluna.
  // Tratar `undefined` como "nao" deixaria o e-mail desligado para TODO MUNDO
  // nessa janela, em silencio e sem nenhum erro.
  const r = separarDestinatarios(
    NOVOS,
    () => undefined,
    () => "qualquer@exemplo.com"
  );
  assert.equal(r.paraEnviar.length, 2);
  assert.equal(r.recusaram, 0);
});

test("so `false` recusa -- null nao recusa", () => {
  const r = separarDestinatarios(
    NOVOS,
    () => null,
    () => "qualquer@exemplo.com"
  );
  assert.equal(r.paraEnviar.length, 2, "null e ausencia de resposta, nao um 'nao'");
});

test("usuario sem endereco vira contagem, nao falha", () => {
  const r = separarDestinatarios(
    NOVOS,
    () => true,
    (u) => (u === "u2" ? null : "a@b.com")
  );
  assert.equal(r.paraEnviar.length, 1);
  assert.equal(r.semEndereco, 1);
  // Nao pode sumir: "0 enviados" com o canal ligado precisa de explicacao no
  // livro-razao, senao parece o canal quebrado.
  assert.equal(r.recusaram, 0);
});

test("endereco vazio conta como sem endereco", () => {
  const r = separarDestinatarios(NOVOS, () => true, () => "");
  assert.equal(r.paraEnviar.length, 0);
  assert.equal(r.semEndereco, 2);
});

test("quem recusou NAO e contado como sem endereco", () => {
  // As duas contagens vao juntas para `cron_runs`. Somar uma na outra faria
  // "ninguem quer e-mail" e "ninguem tem e-mail" -- que exigem acoes opostas --
  // virarem o mesmo numero.
  const r = separarDestinatarios(NOVOS, () => false, () => null);
  assert.equal(r.recusaram, 2);
  assert.equal(r.semEndereco, 0);
});

// ---------------------------------------------------------------------------
// O ENVIO
// ---------------------------------------------------------------------------

test("envio bem-sucedido devolve o id da mensagem", async () => {
  await comAmbiente({ RESEND_API_KEY: "re_teste", EMAIL_FROM: "a@b.com" }, async () => {
    let r;
    await comFetch(
      () => aceito("msg_123"),
      async () => {
        r = await enviarEmails([{ id: "n1", destino: "x@y.com", title: "t", body: "b" }]);
      }
    );
    assert.equal(r.enviados, 1);
    assert.deepEqual(r.entregues, [{ id: "n1", messageId: "msg_123" }]);
    assert.deepEqual(r.falhas, []);
  });
});

test("2xx SEM id e falha, nao sucesso", async () => {
  // Sem o id nao ha como conferir a entrega no painel do provedor, e a rota
  // gravaria `emailed_at` sem nada que sustente o "saiu".
  await comAmbiente({ RESEND_API_KEY: "re_teste", EMAIL_FROM: "a@b.com" }, async () => {
    let r;
    await comFetch(
      () => ({ ok: true, status: 200, json: async () => ({}) }),
      async () => {
        r = await enviarEmails([{ id: "n1", destino: "x@y.com", title: "t", body: "b" }]);
      }
    );
    assert.equal(r.enviados, 0);
    assert.equal(r.entregues.length, 0);
    assert.equal(r.falhas.length, 1);
  });
});

test("a mensagem de erro do provedor sobrevive ate o resultado", async () => {
  // "domain is not verified" e "API key is invalid" exigem acoes opostas. Um
  // "falhou" generico faz as duas parecerem a mesma coisa, e quem le o
  // `cron_runs` nao tem como saber qual aconteceu.
  await comAmbiente({ RESEND_API_KEY: "re_teste", EMAIL_FROM: "a@b.com" }, async () => {
    let r;
    await comFetch(
      () => ({
        ok: false,
        status: 403,
        json: async () => ({ message: "The pulodogato.com domain is not verified." }),
      }),
      async () => {
        r = await enviarEmails([{ id: "n1", destino: "x@y.com", title: "t", body: "b" }]);
      }
    );
    assert.equal(r.enviados, 0);
    assert.equal(r.falhas.length, 1);
    assert.match(r.falhas[0].erro, /not verified/);
    assert.match(r.falhas[0].erro, /403/);
  });
});

test("provedor fora do ar nao derruba o cron", async () => {
  await comAmbiente({ RESEND_API_KEY: "re_teste", EMAIL_FROM: "a@b.com" }, async () => {
    let r;
    await comFetch(
      () => {
        throw new Error("ECONNREFUSED");
      },
      async () => {
        r = await enviarEmails([{ id: "n1", destino: "x@y.com", title: "t", body: "b" }]);
      }
    );
    assert.equal(r.falhas.length, 1);
    assert.match(r.falhas[0].erro, /ECONNREFUSED/);
    assert.equal(r.desligado, false, "provedor caido nao e canal desligado");
  });
});

test("uma falha nao impede o proximo aviso", async () => {
  await comAmbiente({ RESEND_API_KEY: "re_teste", EMAIL_FROM: "a@b.com" }, async () => {
    let r;
    await comFetch(
      (n) => (n === 1 ? { ok: false, status: 500, json: async () => ({}) } : aceito("msg_2")),
      async () => {
        r = await enviarEmails([
          { id: "n1", destino: "x@y.com", title: "t", body: "b" },
          { id: "n2", destino: "z@y.com", title: "t", body: "b" },
        ]);
      }
    );
    assert.equal(r.enviados, 1);
    assert.equal(r.falhas.length, 1);
  });
});

test("a requisicao leva o remetente, o destino e a chave de idempotencia", async () => {
  await comAmbiente(
    { RESEND_API_KEY: "re_teste", EMAIL_FROM: "PuloDoGato <avisos@exemplo.com>" },
    async () => {
      const chamadas = await comFetch(
        () => aceito("msg_1"),
        async () => {
          await enviarEmails([
            { id: "n-abc", destino: "helio@exemplo.com", title: "Aluguel", body: "R$ 1,00" },
          ]);
        }
      );

      assert.equal(chamadas.length, 1);
      assert.equal(chamadas[0].url, "https://api.resend.com/emails");

      const h = chamadas[0].init.headers;
      assert.equal(h.Authorization, "Bearer re_teste");
      // Segunda linha de defesa contra o e-mail dobrado: se a entrega sair e a
      // marcacao no banco falhar logo depois, o provedor reconhece a chave.
      assert.equal(h["Idempotency-Key"], "bill-notification-n-abc");

      const corpo = JSON.parse(chamadas[0].init.body);
      assert.equal(corpo.from, "PuloDoGato <avisos@exemplo.com>");
      assert.deepEqual(corpo.to, ["helio@exemplo.com"]);
      assert.equal(corpo.subject, "Aluguel");
      assert.ok(corpo.html);
      assert.ok(corpo.text);
    }
  );
});

test("avisos diferentes levam chaves de idempotencia diferentes", async () => {
  // Uma chave fixa faria o provedor engolir o SEGUNDO aviso do dia -- duas
  // contas vencendo no mesmo dia, um e-mail so, sem erro em lugar nenhum.
  await comAmbiente({ RESEND_API_KEY: "re_teste", EMAIL_FROM: "a@b.com" }, async () => {
    const chamadas = await comFetch(
      (n) => aceito(`msg_${n}`),
      async () => {
        await enviarEmails([
          { id: "n1", destino: "x@y.com", title: "t", body: "b" },
          { id: "n2", destino: "x@y.com", title: "t", body: "b" },
        ]);
      }
    );
    const chaves = chamadas.map((c) => c.init.headers["Idempotency-Key"]);
    assert.equal(new Set(chaves).size, 2);
  });
});

// ---------------------------------------------------------------------------
// RODAR O CRON DUAS VEZES NAO MANDA DOIS E-MAILS
// ---------------------------------------------------------------------------
// A garantia de verdade e a UNIQUE (scheduled_transaction_id, kind,
// reference_date) da 009: o upsert com `ignoreDuplicates` devolve APENAS as
// linhas recem-gravadas, e e sobre essa lista que o e-mail roda. A segunda
// execucao do dia recebe lista vazia.
//
// Essa parte e provada no banco, em database/tests/047_aviso_por_email_test.sql
// -- aqui ficam as duas pontas que o SQL nao alcanca.

test("segunda execucao do dia: lista vazia nao fala com o provedor", async () => {
  await comAmbiente({ RESEND_API_KEY: "re_teste", EMAIL_FROM: "a@b.com" }, async () => {
    const chamadas = await comFetch(
      () => aceito("nao deveria"),
      async () => {
        const r = await enviarEmails([]);
        assert.equal(r.enviados, 0);
        assert.equal(r.desligado, false, "ocioso nao e desligado");
      }
    );
    assert.equal(chamadas.length, 0);
  });
});

test("a rota manda os RECEM-GRAVADOS, nao a lista de alertas do dia", async () => {
  // A assercao acima e necessaria e insuficiente: ela so vale enquanto a rota
  // passar `novos` para separarDestinatarios. Trocar por `lista` -- os alertas
  // do dia, incluindo os ja avisados -- compila, passa em todo teste de unidade
  // e reenvia o mesmo e-mail todo dia ate a conta ser paga.
  //
  // Nenhum teste de unidade enxerga essa troca, porque ela acontece na
  // composicao. Entao esta suite le a rota.
  const { readFileSync } = await import("node:fs");
  const rota = readFileSync(
    new URL("../app/api/cron/bill-alerts/route.ts", import.meta.url),
    "utf8"
  );

  const chamada = rota.match(/separarDestinatarios\(\s*([A-Za-z_][A-Za-z0-9_]*)/);
  assert.ok(chamada, "nao achei a chamada de separarDestinatarios na rota");
  assert.equal(
    chamada[1],
    "novos",
    "o e-mail tem que sair sobre `novos` (os recem-gravados), nunca sobre `lista`"
  );
});

// ---------------------------------------------------------------------------
// O QUE VAI PARAR EM cron_runs
// ---------------------------------------------------------------------------

test("com o canal desligado a rota nao procura o endereco de ninguem", async () => {
  // `enderecosDe` e uma chamada a API de admin POR USUARIO, todo dia. Sem a
  // chave do provedor nenhuma delas pode terminar em envio: seria custo e
  // latencia puros numa rota com teto de 60s, por um canal que esta off.
  //
  // E as contagens tem que ficar ZERADAS, nao "todo mundo sem endereco". As
  // duas pedem acoes diferentes: `0 enviados, 4 sem endereco` manda investigar
  // o cadastro dos usuarios quando o que faltava era uma variavel de ambiente.
  const { readFileSync } = await import("node:fs");
  const rota = readFileSync(
    new URL("../app/api/cron/bill-alerts/route.ts", import.meta.url),
    "utf8"
  ).replace(/\/\/.*$/gm, "");

  assert.match(
    rota,
    /const canalLigado = configuracaoDeEmail\(\) !== null;/,
    "a guarda tem que sair da MESMA funcao que decide o envio, nao de outra leitura de env"
  );
  assert.match(
    rota,
    /const emails = canalLigado\s*\n\s*\? await enderecosDe\(/,
    "a busca de endereco precisa estar atras da guarda do canal"
  );
  assert.match(
    rota,
    /const \{ paraEnviar, recusaram, semEndereco \} = canalLigado\s*\n\s*\? separarDestinatarios\(/,
    "as contagens precisam ficar zeradas quando o canal esta desligado"
  );
});

test("o corpo do dia COM avisos carrega o resultado do e-mail", async () => {
  // A assercao do dia ocioso (abaixo) nao cobre este caminho, e e este que
  // importa mais: num dia com vencimento, um corpo sem `email_desligado` faz
  // `cron_runs` registrar "3 avisos, push 0" sem dizer uma palavra sobre o
  // e-mail -- exatamente o silencio que esta feature existe para acabar.
  const { readFileSync } = await import("node:fs");
  const rota = readFileSync(
    new URL("../app/api/cron/bill-alerts/route.ts", import.meta.url),
    "utf8"
  );

  const bloco = rota.match(/avisos:\s*novos\.length[\s\S]*?\n      \},/);
  assert.ok(bloco, "nao achei o corpo de resposta do dia com avisos");

  // Os COMENTARIOS saem antes de afirmar qualquer coisa. O comentario que
  // explica `email_desligado` cita o nome do campo, e sem este corte a
  // assercao passa a casar com a explicacao -- apagar a linha de codigo
  // continuaria verde. Foi assim que o mutante sobreviveu na primeira versao
  // desta suite.
  const corpo = bloco[0].replace(/\/\/.*$/gm, "");

  for (const campo of ["email:", "email_desligado:", "email_falhas:", "email_sem_endereco:"]) {
    assert.ok(
      corpo.includes(campo),
      `o corpo que vai para cron_runs precisa carregar ${campo}`
    );
  }
});

test("a rota reporta o desligamento tambem no dia ocioso", async () => {
  // O dia normal deste cron e o dia sem nada a avisar. Se o early-return nao
  // disser nada sobre o e-mail, o estado do canal so apareceria no primeiro dia
  // com vencimento -- e meses de `cron_runs` tranquilos nao responderiam "o
  // e-mail estava ligado?".
  const { readFileSync } = await import("node:fs");
  const rota = readFileSync(
    new URL("../app/api/cron/bill-alerts/route.ts", import.meta.url),
    "utf8"
  );

  const ocioso = rota.match(/avisos:\s*0[\s\S]{0,160}?\}/);
  assert.ok(ocioso, "nao achei o early-return de 'nada a avisar'");
  assert.match(
    ocioso[0],
    /email_desligado/,
    "o corpo do dia ocioso precisa dizer se o canal de e-mail esta ligado"
  );
});
