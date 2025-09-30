# API Specification - Controle de Investimentos

## Visão Geral

Esta documentação descreve a API REST para o sistema de controle de investimentos. A API segue os padrões RESTful e retorna dados em formato JSON.

### Base URL

```
Development: http://localhost:3000/api
Production: https://pulodogato-investments.vercel.app/api
```

### Autenticação

Todas as rotas protegidas requerem um token JWT válido do Supabase Auth.

```http
Authorization: Bearer <jwt_token>
```

### Formato de Resposta

```json
{
  "success": true,
  "data": {},
  "error": null,
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

---

## 🔐 Autenticação

### POST /api/auth/signup

Registra um novo usuário.

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "fullName": "João Silva"
}
```

**Response (201):**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "fullName": "João Silva"
    },
    "session": {
      "accessToken": "jwt_token",
      "refreshToken": "refresh_token"
    }
  }
}
```

### POST /api/auth/signin

Autentica um usuário existente.

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "fullName": "João Silva"
    },
    "session": {
      "accessToken": "jwt_token",
      "refreshToken": "refresh_token"
    }
  }
}
```

---

## 👤 Perfil do Usuário

### GET /api/profile

Obtém o perfil do usuário autenticado.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "fullName": "João Silva",
    "email": "user@example.com",
    "phone": "+55119999999",
    "avatarUrl": "https://...",
    "preferences": {
      "currency": "BRL",
      "timezone": "America/Sao_Paulo",
      "notifications": {
        "dividends": true,
        "priceAlerts": false
      }
    },
    "createdAt": "2025-09-23T10:00:00Z"
  }
}
```

### PATCH /api/profile

Atualiza o perfil do usuário.

**Request Body:**

```json
{
  "fullName": "João Silva Santos",
  "phone": "+55119999999",
  "preferences": {
    "notifications": {
      "dividends": false,
      "priceAlerts": true
    }
  }
}
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "fullName": "João Silva Santos",
    "phone": "+55119999999",
    "updatedAt": "2025-09-23T10:30:00Z"
  }
}
```

---

## 📁 Portfólios

### GET /api/portfolios

Lista todos os portfólios do usuário.

**Query Parameters:**

- `include`: `summary,positions,allocation` (opcional)

**Response (200):**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Carteira Principal",
      "description": "Carteira padrão",
      "isDefault": true,
      "baseCurrency": "BRL",
      "summary": {
        "totalValue": 50000.0,
        "totalInvested": 45000.0,
        "totalPnL": 5000.0,
        "pnlPercent": 11.11,
        "totalAssets": 8
      },
      "createdAt": "2025-01-01T10:00:00Z"
    }
  ]
}
```

### POST /api/portfolios

Cria um novo portfólio.

**Request Body:**

```json
{
  "name": "Carteira de Crescimento",
  "description": "Foco em ações de crescimento",
  "baseCurrency": "BRL"
}
```

### GET /api/portfolios/[id]

Obtém detalhes de um portfólio específico.

**Query Parameters:**

- `include`: `positions,transactions,allocation`

**Response (200):**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Carteira Principal",
    "positions": [
      {
        "id": "uuid",
        "asset": {
          "symbol": "PETR4",
          "name": "Petrobras ON",
          "category": "STOCK",
          "currentPrice": 32.45
        },
        "quantity": 100,
        "averagePrice": 30.45,
        "totalInvested": 3045.0,
        "currentValue": 3245.0,
        "unrealizedPnL": 200.0,
        "pnlPercent": 6.57,
        "totalDividends": 45.3
      }
    ]
  }
}
```

---

## 📊 Ativos

### GET /api/assets

Lista ativos disponíveis.

**Query Parameters:**

- `search`: Busca por símbolo ou nome
- `category`: Filtra por categoria (STOCK, FII, ETF, etc.)
- `currency`: Filtra por moeda (BRL, USD, EUR)
- `limit`: Limite de resultados (padrão: 20)
- `page`: Página (padrão: 1)

**Response (200):**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "symbol": "PETR4",
      "name": "Petróleo Brasileiro S.A. - Petrobras",
      "category": {
        "name": "STOCK",
        "displayName": "Ações",
        "colorHex": "#10B981"
      },
      "currency": "BRL",
      "currentPrice": 32.45,
      "priceChange": 0.85,
      "priceChangePercent": 2.69,
      "sector": "Energy",
      "isActive": true
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

### GET /api/assets/[symbol]

Obtém detalhes de um ativo específico.

**Query Parameters:**

- `include`: `priceHistory,dividends`

**Response (200):**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "symbol": "PETR4",
    "name": "Petróleo Brasileiro S.A. - Petrobras",
    "category": {
      "name": "STOCK",
      "displayName": "Ações"
    },
    "currentPrice": 32.45,
    "previousClose": 31.6,
    "priceChange": 0.85,
    "priceChangePercent": 2.69,
    "marketCap": 400000000000,
    "volume": 15500000,
    "sector": "Energy",
    "industry": "Oil & Gas",
    "description": "Empresa brasileira do setor de energia...",
    "priceHistory": [
      {
        "date": "2025-09-23",
        "open": 31.8,
        "high": 32.5,
        "low": 31.7,
        "close": 32.45,
        "volume": 15500000
      }
    ]
  }
}
```

---

## 💰 Transações

### GET /api/transactions

Lista transações do usuário.

**Query Parameters:**

- `portfolioId`: Filtra por portfólio
- `assetId`: Filtra por ativo
- `type`: Filtra por tipo (BUY, SELL, DIVIDEND)
- `startDate`: Data inicial (YYYY-MM-DD)
- `endDate`: Data final (YYYY-MM-DD)
- `limit`: Limite (padrão: 20)
- `page`: Página (padrão: 1)

**Response (200):**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "portfolio": {
        "id": "uuid",
        "name": "Carteira Principal"
      },
      "asset": {
        "symbol": "PETR4",
        "name": "Petrobras ON"
      },
      "type": "BUY",
      "quantity": 100,
      "price": 30.45,
      "brokerageFee": 5.0,
      "exchangeFee": 0.5,
      "totalFees": 5.5,
      "grossAmount": 3045.0,
      "netAmount": 3050.5,
      "transactionDate": "2025-09-20",
      "notes": "Primeira compra de PETR4",
      "createdAt": "2025-09-20T14:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

### POST /api/transactions

Registra uma nova transação.

**Request Body:**

```json
{
  "portfolioId": "uuid",
  "assetId": "uuid",
  "type": "BUY",
  "quantity": 100,
  "price": 30.45,
  "brokerageFee": 5.0,
  "exchangeFee": 0.5,
  "transactionDate": "2025-09-20",
  "notes": "Compra inicial"
}
```

**Response (201):**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "portfolioId": "uuid",
    "assetId": "uuid",
    "type": "BUY",
    "quantity": 100,
    "price": 30.45,
    "netAmount": 3050.5,
    "transactionDate": "2025-09-20",
    "createdAt": "2025-09-20T14:30:00Z"
  }
}
```

### GET /api/transactions/[id]

Obtém detalhes de uma transação.

**Response (200):**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "portfolio": {
      "id": "uuid",
      "name": "Carteira Principal"
    },
    "asset": {
      "symbol": "PETR4",
      "name": "Petrobras ON",
      "currentPrice": 32.45
    },
    "type": "BUY",
    "quantity": 100,
    "price": 30.45,
    "fees": {
      "brokerage": 5.0,
      "exchange": 0.5,
      "total": 5.5
    },
    "amounts": {
      "gross": 3045.0,
      "net": 3050.5
    },
    "transactionDate": "2025-09-20",
    "notes": "Primeira compra",
    "metadata": {},
    "createdAt": "2025-09-20T14:30:00Z"
  }
}
```

### PUT /api/transactions/[id]

Atualiza uma transação existente.

**Request Body:**

```json
{
  "quantity": 150,
  "price": 30.5,
  "notes": "Quantidade atualizada"
}
```

### DELETE /api/transactions/[id]

Remove uma transação.

**Response (204):** No content

---

## 💎 Dividendos

### GET /api/dividends

Lista dividendos do usuário.

**Query Parameters:**

- `assetId`: Filtra por ativo
- `status`: Filtra por status (ANNOUNCED, PAID, etc.)
- `year`: Filtra por ano
- `limit`: Limite (padrão: 20)

**Response (200):**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "asset": {
        "symbol": "PETR4",
        "name": "Petrobras ON"
      },
      "amountPerShare": 0.45,
      "quantityEligible": 100,
      "totalAmount": 45.0,
      "taxAmount": 6.75,
      "netAmount": 38.25,
      "exDate": "2025-09-15",
      "paymentDate": "2025-09-30",
      "dividendType": "DIVIDEND",
      "status": "PAID",
      "createdAt": "2025-09-10T10:00:00Z"
    }
  ]
}
```

### POST /api/dividends

Registra recebimento de dividendo.

**Request Body:**

```json
{
  "assetId": "uuid",
  "amountPerShare": 0.45,
  "quantityEligible": 100,
  "exDate": "2025-09-15",
  "paymentDate": "2025-09-30",
  "dividendType": "DIVIDEND",
  "taxAmount": 6.75
}
```

---

## 📈 Relatórios e Analytics

### GET /api/reports/dashboard

Obtém dados do dashboard principal.

**Query Parameters:**

- `portfolioId`: ID do portfólio (opcional, padrão é o principal)
- `period`: Período (1D, 1W, 1M, 3M, 6M, 1Y, ALL)

**Response (200):**

```json
{
  "success": true,
  "data": {
    "summary": {
      "totalValue": 50000.0,
      "totalInvested": 45000.0,
      "totalPnL": 5000.0,
      "pnlPercent": 11.11,
      "dailyChange": 234.5,
      "dailyChangePercent": 0.47,
      "totalDividends": 1200.0,
      "dividendsThisMonth": 123.45
    },
    "allocation": [
      {
        "category": "STOCK",
        "categoryName": "Ações",
        "value": 30000.0,
        "percentage": 60.0,
        "colorHex": "#10B981"
      },
      {
        "category": "FII",
        "categoryName": "FIIs",
        "value": 12500.0,
        "percentage": 25.0,
        "colorHex": "#F59E0B"
      }
    ],
    "topHoldings": [
      {
        "asset": {
          "symbol": "PETR4",
          "name": "Petrobras"
        },
        "quantity": 100,
        "averagePrice": 30.45,
        "currentPrice": 32.45,
        "currentValue": 3245.0,
        "pnlPercent": 6.57,
        "weight": 6.49
      }
    ],
    "performance": [
      {
        "date": "2025-09-01",
        "portfolioValue": 48500.0,
        "invested": 45000.0
      },
      {
        "date": "2025-09-23",
        "portfolioValue": 50000.0,
        "invested": 45000.0
      }
    ]
  }
}
```

### GET /api/reports/performance

Relatório de performance detalhado.

**Query Parameters:**

- `portfolioId`: ID do portfólio
- `period`: Período de análise
- `benchmark`: Benchmark para comparação (IBOV, CDI, IFIX)

**Response (200):**

```json
{
  "success": true,
  "data": {
    "portfolio": {
      "return": 11.11,
      "volatility": 18.5,
      "sharpeRatio": 0.45,
      "maxDrawdown": -8.2,
      "bestDay": 3.2,
      "worstDay": -4.1
    },
    "benchmark": {
      "name": "IBOVESPA",
      "return": 8.5,
      "alpha": 2.61,
      "beta": 0.95,
      "correlation": 0.85
    },
    "monthlyReturns": [
      {
        "month": "2025-01",
        "portfolioReturn": 2.5,
        "benchmarkReturn": 1.8
      }
    ]
  }
}
```

---

## 🔍 Pesquisa e Filtros

### GET /api/search

Busca global no sistema.

**Query Parameters:**

- `q`: Termo de busca
- `type`: Tipo de resultado (assets, transactions, portfolios)
- `limit`: Limite (padrão: 10)

**Response (200):**

```json
{
  "success": true,
  "data": {
    "assets": [
      {
        "id": "uuid",
        "symbol": "PETR4",
        "name": "Petrobras",
        "type": "asset"
      }
    ],
    "transactions": [
      {
        "id": "uuid",
        "description": "Compra PETR4 - 100 cotas",
        "date": "2025-09-20",
        "type": "transaction"
      }
    ]
  }
}
```

---

## 📱 Configurações e Preferências

### GET /api/settings

Obtém configurações do usuário.

**Response (200):**

```json
{
  "success": true,
  "data": {
    "notifications": {
      "dividends": true,
      "priceAlerts": false,
      "portfolioSummary": true,
      "emailReports": false
    },
    "dashboard": {
      "defaultPeriod": "1Y",
      "showPercentage": true,
      "chartType": "line",
      "theme": "light"
    },
    "privacy": {
      "publicProfile": false,
      "sharePortfolio": false
    }
  }
}
```

### PATCH /api/settings

Atualiza configurações.

**Request Body:**

```json
{
  "notifications": {
    "dividends": false
  },
  "dashboard": {
    "theme": "dark"
  }
}
```

---

## 📊 Webhooks (Futuro)

### POST /api/webhooks/price-update

Webhook para atualização de preços.

### POST /api/webhooks/dividend-announcement

Webhook para anúncio de dividendos.

---

## ❌ Códigos de Erro

### Códigos HTTP

- `200` - OK
- `201` - Created
- `204` - No Content
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict
- `422` - Unprocessable Entity
- `429` - Too Many Requests
- `500` - Internal Server Error

### Formato de Erro

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Dados inválidos fornecidos",
    "details": {
      "field": "email",
      "message": "Email já está em uso"
    }
  },
  "data": null
}
```

### Códigos de Erro Específicos

- `AUTH_REQUIRED` - Autenticação necessária
- `INVALID_CREDENTIALS` - Credenciais inválidas
- `USER_NOT_FOUND` - Usuário não encontrado
- `PORTFOLIO_NOT_FOUND` - Portfólio não encontrado
- `ASSET_NOT_FOUND` - Ativo não encontrado
- `TRANSACTION_NOT_FOUND` - Transação não encontrada
- `INSUFFICIENT_BALANCE` - Saldo insuficiente para venda
- `INVALID_QUANTITY` - Quantidade inválida
- `INVALID_DATE` - Data inválida
- `VALIDATION_ERROR` - Erro de validação
- `RATE_LIMIT_EXCEEDED` - Limite de requests excedido

---

## 🔒 Rate Limiting

### Limites por Endpoint

- `POST /api/auth/*`: 5 requests/minuto
- `GET /api/*`: 100 requests/minuto
- `POST /api/transactions`: 20 requests/minuto
- `PUT/DELETE /api/*`: 30 requests/minuto

### Headers de Rate Limit

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1632384000
```

---

## 📝 Versionamento

A API utiliza versionamento via header:

```http
API-Version: v1
```

Versões suportadas:

- `v1` - Versão atual (padrão)

---

## 🧪 Ambiente de Teste

### Base URL de Teste

```
https://pulodogato-staging.vercel.app/api
```

### Dados de Teste

Usuário de teste:

```json
{
  "email": "test@pulodogato.com",
  "password": "Test123!"
}
```

### Postman Collection

[Download da collection Postman](./postman-collection.json)

---

## 📚 SDKs e Bibliotecas

### JavaScript/TypeScript

```bash
npm install @pulodogato/sdk
```

```typescript
import { PulodoGatoClient } from "@pulodogato/sdk";

const client = new PulodoGatoClient({
  apiKey: "your-api-key",
  baseUrl: "https://api.pulodogato.com",
});

const portfolios = await client.portfolios.list();
```

---

**Última atualização:** 23/09/2025  
**Versão da API:** v1.0
