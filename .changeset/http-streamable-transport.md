---
"pw2c-lightrag-server-mcp": minor
---

Adiciona transporte **HTTP Streamable** nativo (`--sse`, endpoint `/mcp` e `GET /health`) para clientes remotos como n8n, mantendo **stdio** como modo predefinido. Variáveis `MCP_HTTP_PORT` e `MCP_HTTP_HOST`.

Overrides por cabeçalho HTTP por sessão MCP (`LIGHTRAG-Server-Url`, `LIGHTRAG-API-Key`, `LIGHTRAG-WORKSPACE`) com fallback a env, allowlist `MCP_ALLOWED_LIGHTRAG_HOSTS` (incluindo `*`), flag `MCP_HTTP_HEADER_OVERRIDES` e logs `[LIGHTRAG]` em rejeições.
