# Graphify no desenvolvimento

O [Graphify](https://github.com/Graphify-Labs/graphify) monta um grafo do código
(funções, imports, chamadas entre arquivos) para o Claude Code consultar antes de
sair lendo arquivo por arquivo. O objetivo é gastar menos tokens nas sessões de
desenvolvimento. Ele **não** muda nada no app: não entra no build do Next.js nem
no banco.

## O que está no repositório

- `.claude/skills/graphify/`: o skill `/graphify` para o Claude Code.
- `.claude/settings.json`: hooks que, antes de buscas e leituras, lembram o Claude
  de consultar o grafo. Só rodam se o comando `graphify` estiver instalado; sem
  ele, não fazem nada.
- `CLAUDE.md`: regras para o Claude usar `graphify query` / `path` / `explain`.
- `graphify-out/` fica fora do git (`.gitignore`): cada máquina gera o seu.

## Instalar no seu computador (uma vez)

```bash
uv tool install graphifyy     # ou: pipx install graphifyy
```

## Gerar o grafo (na raiz do projeto)

```bash
graphify update .
```

Leva cerca de 20 segundos, roda só local (análise de AST, sem chamar API) e
gera `graphify-out/` (~12 MB). Rode de novo depois de puxar mudanças grandes;
o próprio Claude roda `graphify update .` depois de editar código.

Para os arquivos `.sql` das migrações entrarem no grafo, instale com o extra:
`uv tool install "graphifyy[sql]"`.

## Sessões do Claude na nuvem

Nas sessões em claude.ai/code o grafo só é usado se o setup do ambiente instalar
o Graphify e gerar o grafo, por exemplo:

```bash
pip install graphifyy && graphify update .
```

Sem isso, os hooks ficam inertes e a sessão funciona como antes.
