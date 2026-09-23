"use client";

// Avisos de vencimento: o que vence, o que ja foi avisado, e quando avisar.
//
// A ordem da tela e a mesma da urgencia: vencidas primeiro, depois o que vence
// dentro da janela, depois a configuracao. Quem abre aqui quer saber se
// esqueceu de pagar alguma coisa.
//
// O push e OPCIONAL de ponta a ponta. Sem as chaves VAPID no servidor, sem
// permissao do navegador ou sem PWA instalado, os avisos continuam aparecendo
// nesta tela -- e a configuracao continua valendo. Amarrar o aviso ao push
// faria o usuario que nao quer notificacao ficar sem nenhum aviso.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { AlertCircle, Bell, BellOff, CalendarClock, Check, Loader2 } from "lucide-react";

const moeda = (valor: number | string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Math.abs(Number(valor))
  );

const dataCurta = (iso: string) => {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano.slice(2)}`;
};

interface Alerta {
  scheduled_transaction_id: string;
  description: string;
  amount: number;
  due_date: string;
  days_until: number;
  kind: "due_soon" | "overdue";
  already_notified: boolean;
  title: string;
  body: string;
}

interface Aviso {
  id: string;
  title: string;
  body: string;
  kind: string;
  channel: string;
  read_at: string | null;
  created_at: string;
}

interface Preferencias {
  days_before: number;
  notify_due_soon: boolean;
  notify_overdue: boolean;
}

/**
 * A chave VAPID chega em base64url e o PushManager exige bytes. Passar a string
 * direto falha com um "InvalidCharacterError" que nao diz nada sobre o que esta
 * errado.
 *
 * O retorno e ArrayBuffer e nao Uint8Array porque o tipo de
 * `applicationServerKey` exige ArrayBufferView<ArrayBuffer>, e o Uint8Array
 * generico do TypeScript 5.7 admite SharedArrayBuffer -- que nao serve.
 */
function chaveParaBytes(base64: string): ArrayBuffer {
  const preenchido = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const normal = preenchido.replace(/-/g, "+").replace(/_/g, "/");
  const bruto = window.atob(normal);
  const bytes = new Uint8Array(new ArrayBuffer(bruto.length));
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
  return bytes.buffer;
}

export default function NotificationsPage() {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [prefs, setPrefs] = useState<Preferencias>({
    days_before: 3,
    notify_due_soon: true,
    notify_overdue: true,
  });
  const [chaveVapid, setChaveVapid] = useState<string | null>(null);
  const [pushAtivo, setPushAtivo] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [mexendoNoPush, setMexendoNoPush] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [rAvisos, rPrefs] = await Promise.all([
        fetch("/api/notifications"),
        fetch("/api/notifications/preferences"),
      ]);

      if (rAvisos.ok) {
        const d = await rAvisos.json();
        setAlertas(d.alerts ?? []);
        setAvisos(d.notifications ?? []);
      }

      if (rPrefs.ok) {
        const d = await rPrefs.json();
        setPrefs({
          days_before: d.preferences.days_before,
          notify_due_soon: d.preferences.notify_due_soon,
          notify_overdue: d.preferences.notify_overdue,
        });
        setChaveVapid(d.vapid_public_key);
      }
    } catch {
      toast.error("Não foi possível carregar os avisos");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Se este aparelho ja tem assinatura, o botao tem que aparecer como ligado.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((s) => setPushAtivo(Boolean(s)))
      .catch(() => setPushAtivo(false));
  }, []);

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      const d = await r.json().catch(() => ({}));

      if (!r.ok) {
        toast.error(d.error ?? "Não foi possível salvar");
        return;
      }

      toast.success("Salvo");
      await carregar();
    } finally {
      setSalvando(false);
    }
  };

  const ligarPush = async () => {
    if (!chaveVapid) {
      toast.error("O push ainda não está configurado no servidor");
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast.error("Este navegador não aceita notificações");
      return;
    }

    setMexendoNoPush(true);
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== "granted") {
        // O navegador so pergunta uma vez: negado, so volta pelas configuracoes
        // do site. Dizer isso evita o usuario clicar de novo sem efeito.
        toast.error(
          "Permissão negada. Libere as notificações nas configurações do site e tente de novo."
        );
        return;
      }

      const registro = await navigator.serviceWorker.ready;
      const assinatura = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chaveParaBytes(chaveVapid),
      });

      const r = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assinatura.toJSON()),
      });
      const d = await r.json().catch(() => ({}));

      if (!r.ok) {
        toast.error(d.error ?? "Não foi possível ativar");
        return;
      }

      setPushAtivo(true);
      toast.success("Avisos ativados neste aparelho");
    } catch {
      // subscribe() rejeita quando o service worker nao esta pronto ou o
      // navegador bloqueia o push em aba anonima.
      toast.error("Não foi possível ativar neste aparelho");
    } finally {
      setMexendoNoPush(false);
    }
  };

  const desligarPush = async () => {
    setMexendoNoPush(true);
    try {
      const registro = await navigator.serviceWorker.ready;
      const assinatura = await registro.pushManager.getSubscription();

      await fetch("/api/push", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: assinatura?.endpoint }),
      });
      await assinatura?.unsubscribe();

      setPushAtivo(false);
      toast.success("Avisos desativados neste aparelho");
    } catch {
      toast.error("Não foi possível desativar");
    } finally {
      setMexendoNoPush(false);
    }
  };

  const marcarLido = async (id: string) => {
    setAvisos((lista) =>
      lista.map((a) => (a.id === id ? { ...a, read_at: new Date().toISOString() } : a))
    );
    await fetch(`/api/notifications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: true }),
    });
  };

  if (carregando) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const vencidas = alertas.filter((a) => a.kind === "overdue");
  const aVencer = alertas.filter((a) => a.kind === "due_soon");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Avisos de vencimento</h1>
        <p className="text-muted-foreground">
          O que vence, o que já venceu, e quantos dias antes você quer ser lembrado.
        </p>
      </div>

      {vencidas.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg text-destructive">
              <AlertCircle className="h-5 w-5" /> {vencidas.length} vencida(s)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {vencidas.map((a) => (
              <div
                key={a.scheduled_transaction_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background p-3"
              >
                <div>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-sm text-muted-foreground">{a.body}</p>
                </div>
                <Badge variant="destructive">{dataCurta(a.due_date)}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarClock className="h-5 w-5" /> A vencer
          </CardTitle>
          <CardDescription>
            Dentro dos {prefs.days_before} dia(s) que você escolheu.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {aVencer.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nada vencendo nesta janela.
            </p>
          ) : (
            aVencer.map((a) => (
              <div
                key={a.scheduled_transaction_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <div>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-sm text-muted-foreground">{a.body}</p>
                </div>
                <div className="flex items-center gap-2">
                  {a.already_notified && (
                    <Badge variant="secondary" className="gap-1">
                      <Check className="h-3 w-3" /> avisado
                    </Badge>
                  )}
                  <Badge variant="outline">{moeda(a.amount)}</Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ---------------- configuracao ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quando avisar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-2 sm:max-w-xs">
            <Label htmlFor="dias">Dias de antecedência</Label>
            <Input
              id="dias"
              type="number"
              min={0}
              max={30}
              value={prefs.days_before}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, days_before: Number(e.target.value) }))
              }
            />
            <p className="text-xs text-muted-foreground">
              0 avisa só no dia do vencimento — que costuma ser tarde demais para pagar sem multa.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">Avisar o que está por vencer</p>
              <p className="text-sm text-muted-foreground">Dentro da janela acima.</p>
            </div>
            <Switch
              checked={prefs.notify_due_soon}
              onCheckedChange={(v) => setPrefs((p) => ({ ...p, notify_due_soon: v }))}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">Avisar o que já venceu</p>
              <p className="text-sm text-muted-foreground">Enquanto continuar sem pagamento.</p>
            </div>
            <Switch
              checked={prefs.notify_overdue}
              onCheckedChange={(v) => setPrefs((p) => ({ ...p, notify_overdue: v }))}
            />
          </div>

          <Button onClick={salvar} disabled={salvando}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </CardContent>
      </Card>

      {/* ---------------- push ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            {pushAtivo ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
            Notificação no celular
          </CardTitle>
          <CardDescription>
            Vale só para este aparelho. Os avisos continuam aparecendo nesta tela de qualquer jeito.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!chaveVapid ? (
            <p className="text-sm text-muted-foreground">
              O envio de notificações ainda não foi configurado no servidor (falta a chave VAPID).
              Enquanto isso, os avisos aparecem aqui e na tela de Contas Previstas.
            </p>
          ) : (
            <Button
              variant={pushAtivo ? "outline" : "default"}
              onClick={pushAtivo ? desligarPush : ligarPush}
              disabled={mexendoNoPush}
            >
              {mexendoNoPush && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {pushAtivo ? "Desativar neste aparelho" : "Ativar neste aparelho"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ---------------- historico ---------------- */}
      {avisos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Avisos enviados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {avisos.map((a) => (
              <div
                key={a.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 ${
                  a.read_at ? "opacity-60" : ""
                }`}
              >
                <div>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-sm text-muted-foreground">{a.body}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{a.channel === "push" ? "push" : "no app"}</Badge>
                  {!a.read_at && (
                    <Button size="sm" variant="ghost" onClick={() => marcarLido(a.id)}>
                      Marcar lido
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
