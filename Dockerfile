# 🐳 Dockerfile para PuloDoGato - Aplicação Next.js
FROM node:20-alpine AS base

# Instalar dependências apenas quando necessário
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copiar arquivos de dependências
COPY package.json package-lock.json* ./
RUN npm ci

# Rebuildar o código fonte apenas quando necessário
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Não copiar .env.local aqui: o .dockerignore exclui o .env.local real, então o
# glob acabava casando só com .env.local.example e gravava valores placeholder
# num .env.local — que o Next.js carrega com precedência MAIOR que .env.production,
# vazando "your_supabase_project_url" para dentro do bundle do cliente.
# O .env.production já vem no `COPY . .`; segredos de build entram por --build-arg.

# Desabilitar telemetria do Next.js durante o build
ENV NEXT_TELEMETRY_DISABLED=1

# Build da aplicação
RUN npm run build

# Imagem de produção, copiar apenas arquivos necessários e rodar Next.js
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Criar usuário não-root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copiar arquivos necessários
COPY --from=builder /app/public ./public

# Definir permissões corretas para cache do Next.js
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automaticamente aproveitar traces de output para reduzir tamanho da imagem
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# 🌐 Expor porta 3000
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# 🚀 Iniciar servidor Next.js
CMD ["node", "server.js"]