# Geração de Ícones PWA

Para gerar os ícones a partir do logo fornecido, você pode usar as seguintes ferramentas:

## Opção 1: Online (Recomendado)

- Acesse: https://realfavicongenerator.net/
- Faça upload do arquivo `logo_pulodogato.png`
- Configure as opções para PWA, Android, iOS
- Baixe o pacote gerado

## Opção 2: Usando ImageMagick (Local)

```bash
# Instalar ImageMagick primeiro
# Windows: choco install imagemagick
# ou baixar de: https://imagemagick.org/script/download.php#windows

# Gerar todos os tamanhos necessários
magick logo_pulodogato.png -resize 16x16 public/icons/icon-16x16.png
magick logo_pulodogato.png -resize 32x32 public/icons/icon-32x32.png
magick logo_pulodogato.png -resize 48x48 public/icons/icon-48x48.png
magick logo_pulodogato.png -resize 72x72 public/icons/icon-72x72.png
magick logo_pulodogato.png -resize 96x96 public/icons/icon-96x96.png
magick logo_pulodogato.png -resize 128x128 public/icons/icon-128x128.png
magick logo_pulodogato.png -resize 144x144 public/icons/icon-144x144.png
magick logo_pulodogato.png -resize 152x152 public/icons/icon-152x152.png
magick logo_pulodogato.png -resize 192x192 public/icons/icon-192x192.png
magick logo_pulodogato.png -resize 384x384 public/icons/icon-384x384.png
magick logo_pulodogato.png -resize 512x512 public/icons/icon-512x512.png

# Gerar favicon.ico
magick logo_pulodogato.png -resize 16x16 -resize 32x32 -resize 48x48 public/favicon.ico
```

## Tamanhos necessários:

- 16x16 (favicon)
- 32x32 (favicon)
- 48x48 (favicon, desktop)
- 72x72 (Android)
- 96x96 (Android)
- 128x128 (Android, desktop)
- 144x144 (Windows)
- 152x152 (iOS)
- 192x192 (Android, PWA)
- 384x384 (PWA)
- 512x512 (PWA, splash screen)
