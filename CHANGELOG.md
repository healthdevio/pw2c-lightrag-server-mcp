# pw2c-lightrag-server-mcp

## 1.1.0

### Minor Changes

- Suporte opcional a **workspace** LightRAG: variável de ambiente `LIGHTRAG_WORKSPACE` e parâmetro `workspace` em todas as tools, enviando o cabeçalho HTTP `LIGHTRAG-WORKSPACE` com precedência tool > env > omissão. Documentação e testes e2e atualizados.

## 1.0.0

### Major Changes

- Primeira release estável **1.0.0** para publicação no npm.

## 0.1.0

### Minor Changes

- Lançamento inicial: servidor MCP (stdio) em TypeScript para a API HTTP LightRAG, ~30 ferramentas, upload multipart, testes e2e com cobertura.
