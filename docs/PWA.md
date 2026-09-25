# PWA — instalar o app no celular

Substitui `PWA_STATUS_FINAL.md` e `PWA_SETUP_GUIDE.md`, que foram apagados. Vale
a pena dizer por que, porque os dois juntos são a explicação de como o app
passou meses sem poder ser instalado sem ninguém notar:

- `PWA_SETUP_GUIDE.md`, na seção "Passos Finais Necessários", dizia
  **"1. Gerar Ícones Reais — você precisa gerar os ícones a partir do logo"**.
  Estava certo. Nunca foi feito.
- `PWA_STATUS_FINAL.md` abria com **"✅ PWA Configurado com Sucesso"** e listava
  **"✅ Desktop PWA — Instalável como app nativo"** e
  **"✅ Favicons em múltiplos tamanhos"**. Estava errado nos três.

Dois documentos sobre o mesmo assunto, discordando, e o que afirmava conclusão
venceu o que listava pendência. Por isso agora é **um** arquivo, e o que
garante que ele continua verdadeiro não é o texto: é o
`.github/workflows/pwa-assets.yml`, que roda em todo PR.

## O que estava quebrado (HMO-145, 25/09/2026)

Todo arquivo em `public/icons/*.png` era um **documento SVG com nome `.png`**, e
o `public/favicon.ico` também:

```
$ head -c 60 public/icons/icon-512x512.png
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ...
```

Nada no caminho reclamava, e essa é a parte que importa:

- a Vercel escolhe o `Content-Type` pela **extensão**, então servia os dez como
  `image/png` com HTTP 200 — o servidor concordava com a mentira;
- o manifest declarava `"type": "image/png"` — o manifest concordava;
- `next build`, `tsc` e o lint não olham dentro de arquivo em `public/`.

**A consequência não era estética.** O Chrome no Android só oferece instalar um
site quando consegue **decodificar** um ícone de 192px ou mais do manifest, e
ele não aceita SVG nesse papel (o Firefox aceita — é essa diferença que faz o
defeito parecer intermitente). Como nenhum dos dez decodificava,
`beforeinstallprompt` nunca era emitido, e o banner "Instalar Pulo do Gato" do
`PWAWrapper` — escrito, correto e commitado desde o início — nunca apareceu.

No iOS a causa era outra e somava: **`beforeinstallprompt` não existe no
Safari**, e não é uma falta que vá ser corrigida. Lá a instalação é sempre
manual, por Compartilhar → Adicionar à Tela de Início. Um app que só espera o
evento nunca se oferece para instalar no iPhone.

Junto com os ícones havia 14 caminhos declarados para arquivos que nunca
existiram e 2 atalhos apontando para rotas sem `page.tsx`. Rodado contra a
árvore anterior, o guard reprova com **34 problemas**.

## Como os ícones são gerados

```bash
npm run generate-pwa-icons     # regera tudo a partir de public/logo_pulodogato.png
npm run check-pwa-assets       # confere sem escrever nada
```

O gerador é Node puro (`scripts/png.mjs` faz o PNG com `zlib`). **Não** use
`sharp`, ImageMagick ou rsvg: nenhum existe neste ambiente, e nenhum deveria
entrar no `package.json` para produzir 20 arquivos estáticos que são commitados.

Duas famílias, porque o Android trata as duas de formas diferentes:

| família | ocupação da aresta | por quê |
| --- | --- | --- |
| `icon-NxN.png` (`purpose: any`) | 0.92 | a tela inteira é o ícone |
| `icon-maskable-NxN.png` (`purpose: maskable`) | 0.56 | o sistema **recorta** na forma que quiser; só o círculo central de 80% é garantido, e o quadrado inscrito nele tem lado 0.8/√2 ≈ 0.566 |

Declarar o mesmo arquivo como `"any maskable"` — o que o manifest fazia em oito
dos onze ícones — garante que um dos dois sai errado: ou sobra moldura no ícone
normal, ou o gato perde as orelhas no adaptativo. O guard reprova isso.

Abaixo de 128px o ícone usa **só o símbolo**, sem o wordmark: "PULO DO GATO" num
favicon de 32px vira tarja ilegível e ainda rouba metade da altura do desenho. O
corte sai da detecção de faixas horizontais do próprio logo, não de coordenada
fixa — se o logo for redesenhado, o corte acompanha.

## O que foi deliberadamente NÃO feito

**Telas de abertura (splash) do iOS.** O layout declarava sete, todas 404. Gerar
as sete custaria entre 1,3 e 3,9 MB commitados (medição no cabeçalho de
`scripts/generate-pwa-icons.mjs`) e cobriria só aparelhos até o iPhone 11: o iOS
exige que a imagem bata **exatamente** com a resolução física, então todo iPhone
recente cairia no fallback de qualquer jeito. Um conjunto pela metade é pior que
nenhum — metade dos usuários abriria com a marca e a outra metade sem.

O fallback é uma tela chapada da cor `background_color` do manifest, hoje
apontada para o creme do próprio logo (`#faf4e9`). Abertura colorida em todo
aparelho, por zero byte.

**Capturas de tela (`screenshots`).** Estavam declaradas e davam 404, o que faz
o Chrome descartar a ficha de instalação rica. Foram **removidas** da
declaração, e não inventadas: uma captura fabricada mostraria uma tela que não
existe. Quando houver capturas reais, acrescentar as duas entradas — o guard
confere que os arquivos existem e têm a dimensão anunciada.

## O que o guard cobre

`npm run check-pwa-assets`, sem filtro de path no CI:

- todo caminho declarado no manifest, no `app/layout.tsx` e no
  `browserconfig.xml` **existe** em `public/`;
- todo `.png` **é** PNG e tem a **dimensão que anuncia** (trocar o de 512 por
  uma cópia do de 192 passaria pelo Chrome, esticado e borrado);
- o `.ico` é um `.ico`;
- existe ícone `any` **e** `maskable` de 192px ou mais — o critério que o Chrome
  usa para oferecer instalação;
- nenhum arquivo é `"any maskable"` ao mesmo tempo;
- `start_url` e todo `shortcuts[].url` têm `page.tsx`.

O que ele **não** cobre: se o ícone está bonito, e se o service worker está
cacheando o que deveria.

## Testar de verdade

Rota 200 não prova tela instalável. Para conferir o critério real, baixe o
manifest de produção e **decodifique** os ícones que ele aponta — é literalmente
o que o Chrome faz. `scripts/png.mjs` exporta `decodificarPNG` para isso.

- **Android/Chrome:** o banner aparece sozinho. DevTools → Application →
  Manifest lista os erros de ícone, um a um.
- **iOS/Safari:** o app mostra a instrução com os ícones do Safari. Só Safari —
  os outros navegadores no iPhone não têm o item de menu.
- **Já instalado:** nenhum convite aparece, em nenhuma plataforma. A regra está
  em `lib/pwa-install.ts`, testada em `scripts/test-pwa-install.mjs`.
