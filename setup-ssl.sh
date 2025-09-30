#!/bin/bash

# Script para adicionar pulodogato.heliomoraes.dev ao certificado existente

echo "🔐 Adicionando pulodogato.heliomoraes.dev ao certificado heliomoraes.dev..."

# Parar o nginx temporariamente para liberação da porta 80
docker-compose -f /root/workspace/nginx/docker-compose.yml down

# Gerar novo certificado incluindo o subdomínio pulodogato
docker run --rm \
  -v /root/workspace/nginx/certbot/conf:/etc/letsencrypt \
  -v /root/workspace/nginx/certbot/www:/var/www/certbot \
  -p 80:80 \
  certbot/certbot certonly \
  --standalone \
  --email helio@heliomoraes.dev \
  --agree-tos \
  --no-eff-email \
  --expand \
  -d heliomoraes.dev \
  -d oes.heliomoraes.dev \
  -d pulodogato.heliomoraes.dev

# Verificar se o certificado foi gerado com sucesso
if [ $? -eq 0 ]; then
    echo "✅ Certificado gerado com sucesso!"
    
    # Reiniciar o nginx
    docker-compose -f /root/workspace/nginx/docker-compose.yml up -d
    
    # Recarregar configuração do nginx
    docker-compose -f /root/workspace/nginx/docker-compose.yml exec nginx nginx -s reload
    
    echo "✅ Nginx reiniciado com nova configuração!"
    echo ""
    echo "🎉 Certificado SSL configurado para pulodogato.heliomoraes.dev"
    echo "🌐 Agora você pode acessar: https://pulodogato.heliomoraes.dev"
else
    echo "❌ Erro ao gerar certificado!"
    # Tentar reiniciar nginx mesmo assim
    docker-compose -f /root/workspace/nginx/docker-compose.yml up -d
    exit 1
fi