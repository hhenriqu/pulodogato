#!/bin/bash

# Script de deploy do PuloDoGato

set -e

echo "🐳 Iniciando deploy do PuloDoGato..."

# Verificar se estamos no diretório correto
if [ ! -f "package.json" ]; then
    echo "❌ Erro: Execute este script no diretório raiz do projeto"
    exit 1
fi

# Verificar se a network nginx-network existe
if ! docker network ls | grep -q nginx-network; then
    echo "📡 Criando network nginx-network..."
    docker network create nginx-network
fi

# Parar containers existentes
echo "🛑 Parando containers existentes..."
docker-compose down --remove-orphans

# Build e iniciar aplicação
echo "🏗️ Building e iniciando aplicação..."
docker-compose up -d --build

# Verificar status
echo "🔍 Verificando status dos containers..."
docker-compose ps

# Mostrar logs
echo "📋 Logs recentes:"
docker-compose logs --tail=20

echo ""
echo "✅ Deploy concluído!"
echo "🌐 Aplicação rodando em: http://localhost:3003"
echo "📊 Para acessar com SSL: https://pulodogato.heliomoraes.dev"
echo ""
echo "💡 Comandos úteis:"
echo "   docker-compose logs -f pulodogato-app  # Ver logs em tempo real"
echo "   docker-compose down                    # Parar aplicação"
echo "   docker-compose up -d                   # Iniciar aplicação"