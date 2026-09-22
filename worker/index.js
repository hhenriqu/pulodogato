// Service worker customizado do PulaDoGato.
//
// O next-pwa gera public/sw.js sozinho (cache das rotas) e ANEXA este arquivo a
// ele durante o build -- por isso ele mora em worker/index.js e nao em public/:
// qualquer coisa escrita direto em public/sw.js e sobrescrita no proximo build.
//
// Aqui so ha o que o workbox nao faz: receber o push do aviso de vencimento e
// abrir a tela certa quando o usuario toca na notificacao.

// eslint-disable-next-line no-undef
self.addEventListener("push", (event) => {
  // Sem dados, ainda assim mostra alguma coisa: um push recebido e nao exibido
  // faz o navegador revogar a permissao do site (a regra do userVisibleOnly).
  let dados = { title: "PulaDoGato", body: "Você tem uma conta para conferir." };

  if (event.data) {
    try {
      dados = { ...dados, ...event.data.json() };
    } catch {
      dados.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(dados.title, {
      body: dados.body,
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-192x192.png",
      // `tag` faz o aviso novo da MESMA conta substituir o anterior, em vez de
      // empilhar tres notificacoes do aluguel na bandeja.
      tag: dados.tag || "pulodogato",
      data: { url: dados.url || "/dashboard/bills" },
    })
  );
});

// eslint-disable-next-line no-undef
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = event.notification.data?.url || "/dashboard/bills";

  event.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Reaproveita uma aba ja aberta do app em vez de abrir a quarta: quem
      // usa o PWA no celular acaba com varias instancias soltas.
      for (const janela of janelas) {
        if (janela.url.includes("/dashboard") && "focus" in janela) {
          await janela.focus();
          if ("navigate" in janela) await janela.navigate(destino);
          return;
        }
      }

      await self.clients.openWindow(destino);
    })()
  );
});
