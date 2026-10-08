// =====================================================
// AVISO DE VENCIMENTO POR E-MAIL - o canal que faltava (HMO-183)
// =====================================================
// O texto do aviso NAO mora aqui. Ele sai de `textoDoAviso()` em
// notifications.ts, e e o mesmo texto que vai para o push e para o sino do
// app. Este arquivo so sabe envelopar esse texto num e-mail e entregar.
//
// Uma definicao de frase para os tres canais e deliberado: duas definicoes
// saem de sincronia na primeira vez que alguem conserta "vence em 1 dias" num
// lugar so, e ninguem percebe, porque os canais nunca sao lidos lado a lado.
//
// POR QUE fetch CRU, SEM BIBLIOTECA
// ---------------------------------
// A API do Resend e um POST com JSON. O pacote `resend` acrescenta uma
// dependencia, um alvo de atualizacao e um bundle maior para encapsular quinze
// linhas. Pior: trocar de provedor passaria a exigir arrancar a biblioteca
// inteira, enquanto aqui a troca e reescrever `entregar()`.
//
// O PADRAO DO chavesVapid(), E O QUE ELE CUSTOU
// ---------------------------------------------
// `configuracaoDeEmail()` devolve null sem a chave, e o canal fica desligado
// sem derrubar o cron -- igual ao push. Esse padrao e correto (uma variavel de
// ambiente opcional nao pode tirar do usuario os avisos que ja funcionam), mas
// foi exatamente ele que deixou o push desligado por meses sem ninguem ver: um
// cron que nao manda nada e um cron que manda tudo respondem o mesmo 200.
//
// Por isso o desligamento aqui nao e silencioso. `ResultadoEmail.desligado`
// sobe ate o corpo da resposta da rota, e o corpo da resposta e gravado em
// `cron_runs.result` pelo livro-razao da 019. "O e-mail esta desligado" vira
// uma linha no banco, todo dia, consultavel -- em vez de uma ausencia.
// =====================================================

/** O remetente de teste do Resend. Ver `configuracaoDeEmail()`. */
export const REMETENTE_SANDBOX = "PuloDoGato <onboarding@resend.dev>";

export interface ConfiguracaoDeEmail {
  apiKey: string;
  remetente: string;
  /**
   * true quando estamos no remetente de teste do provedor.
   *
   * `onboarding@resend.dev` funciona sem verificar dominio nenhum, o que o
   * torna otimo para provar a entrega ponta a ponta -- e uma armadilha para
   * producao: o Resend SO entrega esse remetente para o dono da conta. Com um
   * dominio nao verificado, o aviso de todo usuario que nao seja o dono some
   * com 200 na resposta do provedor.
   *
   * Entao a flag existe para esse meio-termo nao ser silencioso: ela sobe
   * junto com o resultado e fica gravada em `cron_runs`. Um canal "meio
   * ligado" e tao invisivel quanto um canal desligado, e custa mais caro.
   */
  sandbox: boolean;
}

/**
 * A configuracao de envio, se o servidor tiver uma.
 *
 * Sem `RESEND_API_KEY` devolve null e o canal fica desligado. O aviso continua
 * sendo gravado em `bill_notifications` e continua aparecendo no sino do app:
 * derrubar o cron inteiro por falta de uma variavel opcional deixaria o
 * usuario sem NENHUM aviso por causa de uma configuracao que ele nao pediu.
 */
export function configuracaoDeEmail(): ConfiguracaoDeEmail | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;

  const remetente = process.env.EMAIL_FROM?.trim();

  return {
    apiKey,
    remetente: remetente || REMETENTE_SANDBOX,
    sandbox: !remetente,
  };
}

export interface CorpoDoEmail {
  subject: string;
  html: string;
  text: string;
}

/** De onde o link do e-mail aponta. Sem isso o botao vira um link quebrado. */
function baseDoApp(): string {
  const bruto = process.env.NEXT_PUBLIC_APP_URL || "https://pulodogato.hmoraes.com.br";
  return bruto.replace(/\/+$/, "");
}

/**
 * Escapa o que vai para dentro do HTML.
 *
 * `description` vem do usuario ("Aluguel & condominio", "Cartao <Nubank>"), e
 * `textoDoAviso` interpola essa string no title. Sem escapar, um `&` quebra o
 * HTML no cliente de e-mail e um `<` come o resto da frase -- o aviso chega
 * truncado justamente na conta com o nome mais incomum.
 */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Envelopa o texto do aviso num e-mail.
 *
 * Recebe `title`/`body` ja prontos -- os MESMOS que foram gravados em
 * `bill_notifications` e mandados no push. Esta funcao nao decide o que
 * escrever, so como embrulhar.
 *
 * `text` acompanha o `html` de proposito: cliente de e-mail sem HTML e filtro
 * de spam leem a versao texto, e um e-mail so-HTML pontua pior nos dois.
 */
export function montarEmailDoAviso(aviso: { title: string; body: string }): CorpoDoEmail {
  const url = `${baseDoApp()}/dashboard/bills`;
  const t = escaparHtml(aviso.title);
  const b = escaparHtml(aviso.body);

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;color:#71717a">PuloDoGato</p>
        <h1 style="margin:0 0 8px;font-size:20px;line-height:1.3">${t}</h1>
        <p style="margin:0 0 24px;font-size:16px;color:#3f3f46">${b}</p>
        <a href="${url}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px">Ver minhas contas</a>
        <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa">
          Para parar de receber estes avisos por e-mail, desligue a opção em Avisos, dentro do app.
        </p>
      </td></tr>
    </table>
  </body>
</html>`;

  // `subject` e o title sem escapar: o cabecalho do e-mail nao e HTML, e
  // escapar aqui faria "Aluguel &amp; condominio" chegar literalmente assim na
  // caixa de entrada.
  return {
    subject: aviso.title,
    html,
    text: `${aviso.title}\n\n${aviso.body}\n\nVer minhas contas: ${url}`,
  };
}

export interface ResultadoEnvio {
  ok: boolean;
  /** O id da mensagem no provedor. E ele que permite conferir a entrega. */
  id?: string;
  erro?: string;
}

/**
 * Quanto esperar pelo provedor.
 *
 * `maxDuration` da rota e 60s. Sem teto, um provedor pendurado consome o
 * orcamento inteiro e a Vercel corta a execucao no meio -- depois de gravar os
 * avisos e antes de responder, que e o unico desfecho que o livro-razao nao
 * consegue registrar.
 */
const TIMEOUT_ENVIO_MS = 10_000;

/**
 * Entrega uma mensagem. Esta e a unica funcao que conhece o Resend.
 *
 * `Idempotency-Key` carrega o id da linha de `bill_notifications`. A UNIQUE
 * (scheduled_transaction_id, kind, reference_date) da 009 ja garante que o
 * cron so manda e-mail para avisos RECEM-gravados, entao rodar o cron duas
 * vezes no mesmo dia nao gera dois e-mails. Esta chave e a segunda linha de
 * defesa, para o caso em que a entrega sai e a marcacao no banco falha logo
 * depois: na proxima tentativa o provedor reconhece a chave e nao reenvia.
 */
async function entregar(
  config: ConfiguracaoDeEmail,
  destino: string,
  corpo: CorpoDoEmail,
  chaveDeIdempotencia: string
): Promise<ResultadoEnvio> {
  try {
    const resposta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": chaveDeIdempotencia,
      },
      body: JSON.stringify({
        from: config.remetente,
        to: [destino],
        subject: corpo.subject,
        html: corpo.html,
        text: corpo.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_ENVIO_MS),
    });

    const dados = (await resposta.json().catch(() => null)) as
      | { id?: string; message?: string; name?: string }
      | null;

    if (!resposta.ok) {
      // A mensagem do provedor importa e precisa sobreviver ate `cron_runs`:
      // "domain is not verified" e "API key is invalid" exigem acoes opostas, e
      // um "falhou" generico faz as duas parecerem a mesma coisa.
      const detalhe = dados?.message || dados?.name || `HTTP ${resposta.status}`;
      return { ok: false, erro: `${resposta.status}: ${detalhe}` };
    }

    // 2xx sem id nao e sucesso: sem o id nao ha como conferir a entrega no
    // painel do provedor, e "mandei" vira uma afirmacao sem prova.
    if (!dados?.id) return { ok: false, erro: "provedor aceitou sem devolver id" };

    return { ok: true, id: dados.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, erro: msg };
  }
}

export interface AvisoParaEnviar {
  /** O id da linha de `bill_notifications`. Vira a chave de idempotencia. */
  id: string;
  destino: string;
  title: string;
  body: string;
}

/**
 * Quem, dos avisos recem-gravados, recebe e-mail.
 *
 * Pura de proposito: e aqui que mora a decisao de quem fica de fora, e ela
 * precisa ser testavel sem banco, sem provedor e sem o runtime do Next.
 *
 * `querEmail` recebe a preferencia como ela veio da view -- inclusive
 * `undefined`, que e o que acontece entre o deploy do app e a colagem da 047.
 * Ausencia vale `true`, pelo mesmo motivo do COALESCE da view: o default do
 * canal e ligado, e tratar ausencia como "nao" deixaria o e-mail desligado
 * para TODO MUNDO durante essa janela, em silencio.
 */
export function separarDestinatarios(
  novos: Array<{ id: string; user_id: string; title: string; body: string }>,
  querEmail: (userId: string) => boolean | undefined,
  enderecoDe: (userId: string) => string | null | undefined
): { paraEnviar: AvisoParaEnviar[]; recusaram: number; semEndereco: number } {
  const paraEnviar: AvisoParaEnviar[] = [];
  let recusaram = 0;
  let semEndereco = 0;

  for (const n of novos) {
    if (querEmail(n.user_id) === false) {
      recusaram++;
      continue;
    }

    const destino = enderecoDe(n.user_id);
    if (!destino) {
      // Conta sem e-mail existe: cadastro por telefone, ou conta criada pelo
      // painel do Supabase. Nao e falha do envio e nao pode virar uma linha de
      // erro em `cron_runs` -- mas tambem nao pode sumir, senao "0 enviados"
      // com o canal ligado nao tem explicacao nenhuma no livro-razao.
      semEndereco++;
      continue;
    }

    paraEnviar.push({ id: n.id, destino, title: n.title, body: n.body });
  }

  return { paraEnviar, recusaram, semEndereco };
}

export interface ResultadoEmail {
  enviados: number;
  /** true quando nao ha `RESEND_API_KEY`: o canal inteiro esta desligado. */
  desligado: boolean;
  /** true quando o remetente e o de teste do provedor. Ver ConfiguracaoDeEmail. */
  sandbox: boolean;
  /** Avisos que nao tinham para onde ir (usuario sem e-mail na conta). */
  semEndereco: number;
  /** As falhas, com a mensagem do provedor. Vai inteiro para `cron_runs`. */
  falhas: Array<{ id: string; erro: string }>;
  /** `bill_notifications.id` -> id da mensagem no provedor. */
  entregues: Array<{ id: string; messageId: string }>;
}

/** O resultado de um canal que nem tentou. Um lugar so, para os dois usos. */
function desligado(): ResultadoEmail {
  return {
    enviados: 0,
    desligado: true,
    sandbox: false,
    semEndereco: 0,
    falhas: [],
    entregues: [],
  };
}

/**
 * Manda os avisos por e-mail.
 *
 * Recebe a lista ja filtrada (quem quer e-mail, e com endereco) porque quem
 * sabe ler preferencia e endereco e a rota, que tem a service_role. Esta
 * funcao fica testavel sem banco.
 */
export async function enviarEmails(avisos: AvisoParaEnviar[]): Promise<ResultadoEmail> {
  const config = configuracaoDeEmail();
  if (!config) return desligado();

  const resultado: ResultadoEmail = {
    enviados: 0,
    desligado: false,
    sandbox: config.sandbox,
    semEndereco: 0,
    falhas: [],
    entregues: [],
  };

  // Sequencial, nao `Promise.all`. O volume aqui e um punhado de contas por
  // dia, e o Resend limita a 2 requisicoes por segundo na conta gratuita --
  // um disparo paralelo leva 429 e perde avisos para ganhar milissegundos
  // numa rota que tem 60 segundos de orcamento.
  for (const aviso of avisos) {
    if (!aviso.destino) {
      resultado.semEndereco++;
      continue;
    }

    const r = await entregar(
      config,
      aviso.destino,
      montarEmailDoAviso(aviso),
      `bill-notification-${aviso.id}`
    );

    if (r.ok && r.id) {
      resultado.enviados++;
      resultado.entregues.push({ id: aviso.id, messageId: r.id });
    } else {
      resultado.falhas.push({ id: aviso.id, erro: r.erro ?? "falha sem mensagem" });
    }
  }

  return resultado;
}
