// =====================================================
// AVISOS DE VENCIMENTO - texto e configuracao do push
// =====================================================
// O QUE VENCE mora na view bill_alerts (009). O que sobra para o TypeScript e
// escrever a frase e falar com o servico de push.
// =====================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export interface BillAlert {
  scheduled_transaction_id: string;
  user_id: string;
  description: string;
  amount: number | string;
  due_date: string;
  days_until: number;
  kind: "due_soon" | "overdue";
  transaction_type: string;
  already_notified: boolean;
  /**
   * Quer o aviso por e-mail? Vem da view (047), com COALESCE para `true`.
   *
   * Opcional no tipo porque `bill_alerts` so passou a devolver a coluna na
   * 047, e o codigo precisa continuar de pe entre o deploy do app e a colagem
   * da migration -- nesse intervalo a chave nao vem no objeto. Quem le decide
   * o que fazer com a ausencia; ver o cron de bill-alerts.
   */
  notify_email?: boolean;
}

export function formatarBRL(valor: number | string): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Math.abs(Number(valor)));
}

/**
 * A frase do aviso.
 *
 * "em 0 dias" e "em 1 dias" sao o tipo de detalhe que faz o app parecer
 * quebrado justamente no aviso mais importante -- o do dia do vencimento.
 */
export function textoDoAviso(alerta: BillAlert): { title: string; body: string } {
  const valor = formatarBRL(alerta.amount);
  const dias = alerta.days_until;

  if (alerta.kind === "overdue") {
    const atraso = Math.abs(dias);
    return {
      title: `${alerta.description} está vencida`,
      body:
        atraso === 1
          ? `${valor} — venceu ontem.`
          : `${valor} — venceu há ${atraso} dias.`,
    };
  }

  if (dias === 0) {
    return { title: `${alerta.description} vence hoje`, body: `${valor} — hoje é o último dia.` };
  }
  if (dias === 1) {
    return { title: `${alerta.description} vence amanhã`, body: valor };
  }
  return { title: `${alerta.description} vence em ${dias} dias`, body: valor };
}

/**
 * O par de chaves VAPID, se o servidor tiver um.
 *
 * Sem as chaves o push simplesmente nao sai, e o aviso continua sendo gravado
 * em bill_notifications com channel 'inapp' -- o sino do app funciona igual. O
 * contrario (derrubar o cron inteiro por falta de uma variavel de ambiente)
 * deixaria o usuario sem NENHUM aviso por causa de uma configuracao opcional.
 */
export function chavesVapid(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;

  return {
    publicKey,
    privateKey,
    // mailto: e exigido pela especificacao do Web Push; os servidores de push
    // recusam a entrega sem um contato valido.
    subject: process.env.VAPID_SUBJECT || "mailto:contato@pulodogato.app",
  };
}

export interface ResultadoPush {
  enviados: number;
  removidos: number;
  desligado: boolean;
}

/**
 * Manda o push para todos os aparelhos de um usuario.
 *
 * 404 e 410 do servico de push significam "esta assinatura morreu" -- o usuario
 * desinstalou o PWA ou limpou os dados do navegador. Nesse caso a linha e
 * apagada: insistir num endpoint morto todo dia, para sempre, faz a tabela
 * crescer sem limite e o cron ficar mais lento a cada execucao.
 */
export async function enviarPush(
  supabase: SupabaseClient,
  userId: string,
  payload: { title: string; body: string; url?: string; tag?: string }
): Promise<ResultadoPush> {
  const vapid = chavesVapid();
  if (!vapid) return { enviados: 0, removidos: 0, desligado: true };

  const { data: assinaturas } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (!assinaturas?.length) return { enviados: 0, removidos: 0, desligado: false };

  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

  let enviados = 0;
  const mortas: string[] = [];

  await Promise.all(
    assinaturas.map(async (a) => {
      try {
        await webpush.sendNotification(
          { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
          JSON.stringify(payload)
        );
        enviados++;
      } catch (erro) {
        // O web-push lanca um erro com `statusCode`/`body` vindos da resposta do
        // push service. 404/410 significam inscricao morta -- e so nesses dois
        // que a assinatura entra na lista para ser apagada.
        const falha = erro as { statusCode?: number; body?: unknown };
        if (falha?.statusCode === 404 || falha?.statusCode === 410) {
          mortas.push(a.id);
        } else {
          console.error("Falha ao enviar push:", falha?.statusCode, falha?.body);
        }
      }
    })
  );

  if (mortas.length) {
    await supabase.from("push_subscriptions").delete().in("id", mortas);
  }

  return { enviados, removidos: mortas.length, desligado: false };
}
