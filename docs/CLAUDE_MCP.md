# Lançar pelo Claude (servidor MCP)

O Pulo do Gato é um conector do Claude. Depois de conectado, dá para escrever
no Claude coisas como "gastei 52,30 no mercado hoje no Nubank" ou "comprei uma
TV de 3.000 em 10x no cartão Itaú, categoria Casa" e o lançamento cai na sua
conta.

**Endereço do conector:** `https://pulodogato.hmoraes.com.br/api/mcp`

## Como conectar

### claude.ai, app do Claude (desktop e celular)

1. Configurações → Conectores → **Adicionar conector personalizado**.
2. Nome: `Pulo do Gato`. URL: o endereço acima. Deixe o OAuth avançado em branco.
3. Clique em **Conectar**. Abre a tela do Pulo do Gato: entre com sua conta e
   clique em **Permitir**.
4. Numa conversa, ligue o conector no menu de ferramentas.

Num plano Team/Enterprise, quem adiciona conector personalizado é o dono da
organização; depois cada pessoa conecta a própria conta.

### Claude Code

```bash
claude mcp add --transport http pulodogato https://pulodogato.hmoraes.com.br/api/mcp
# dentro do Claude Code: /mcp -> pulodogato -> Authenticate
```

Ou com um token pessoal (Configurações → Claude → Gerar token pessoal):

```bash
claude mcp add --transport http pulodogato https://pulodogato.hmoraes.com.br/api/mcp \
  --header "Authorization: Bearer pdg_..."
```

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `listar_contas` | Contas e cartões ativos, com a fatura aberta de cada cartão |
| `listar_categorias` | Categorias e subcategorias (com os apelidos da pessoa) |
| `listar_grupos` | Grupos em que a pessoa está ativa (ex.: Casa) |
| `listar_lancamentos` | Últimos lançamentos, para conferir e não duplicar |
| `lancar_despesa` | Despesa à vista: conta, Pix, dinheiro ou 1x no cartão; opcionalmente num grupo ou numa fatura escolhida |
| `lancar_receita` | Receita numa conta |
| `lancar_compra_parcelada` | Compra parcelada no cartão: valor total ou da parcela, N parcelas, a partir da fatura da compra (ou de uma escolhida) |

Conta, cartão, categoria e grupo são achados pelo **nome** (sem acento e sem
caixa). Se o nome bater com mais de um, a ferramenta devolve as opções e o
Claude pergunta.

## Segurança

- Cada pessoa só lança na própria conta. O token vira uma sessão normal dela
  (o mesmo `generateLink` + `verifyOtp` do "Entrar como") e toda leitura e
  escrita passa pela RLS, com a anon key. A service role só é usada para ler o
  hash do token e criar a linha do token.
- Do token só o SHA-256 fica no banco (`tokens_do_claude`, migration 085).
- Configurações → Claude mostra as conexões e o último uso, e **Desconectar**
  corta o acesso na hora.
- OAuth 2.1 sem estado: o `client_id` do registro dinâmico e o código de
  autorização são pacotes assinados com um segredo derivado da
  `SUPABASE_SERVICE_ROLE_KEY` (nenhuma variável nova). PKCE S256 é obrigatório
  e o código é de uso único (UNIQUE em `codigo_hash`).

## Peças

| Arquivo | Papel |
|---|---|
| `app/api/mcp/route.ts` | O servidor MCP (Streamable HTTP, sem estado, JSON) |
| `lib/services/mcp-ferramentas.ts` | As ferramentas |
| `lib/services/mcp-sessao.ts` | Token → dona → sessão dela |
| `lib/acesso-pelo-claude.ts` | Regras puras (token, pacote assinado, PKCE, achar pelo nome) |
| `app/api/mcp/oauth/*` | Registro, autorização, token e metadados (`/.well-known/*` via rewrite) |
| `app/(auth)/conectar-claude/page.tsx` | A tela de "Permitir" |
| `components/configuracoes/ConexaoComOClaude.tsx` | Configurações → Claude |
| `database/migrations/085_acesso_pelo_claude.sql` | A tabela dos tokens |

Requer `SUPABASE_SERVICE_ROLE_KEY` no ambiente da Vercel (já usada pelo
"Entrar como" e pelos crons).
