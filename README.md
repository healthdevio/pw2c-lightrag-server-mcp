# pw2c-lightrag-server-mcp

Servidor [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) em **TypeScript** para a API HTTP do [LightRAG](https://github.com/HKUDS/LightRAG). Expõe cerca de **30 ferramentas** para gestão de documentos, consultas RAG, grafo de conhecimento e estado do sistema — no mesmo espírito do projeto de referência [lalitsuryan/lightragmcp](https://github.com/lalitsuryan/lightragmcp), com cliente HTTP alinhado ao contrato real da API (incluindo **upload em `multipart/form-data`** com o campo `file`).

## Funcionalidades

- Cobertura das principais rotas LightRAG usadas em fluxos de RAG e knowledge graph
- Modos de query: `naive`, `local`, `global`, `hybrid`, `mix`
- Inserção de texto, upload de ficheiros (path sob o diretório de trabalho ou base64), scan, listagens, pipeline e cancelamento
- Operações de grafo: labels, entidades, relações, merge
- Autenticação opcional via cabeçalho `X-API-Key`
- Instalação e execução via `npx` após publicação no npm

## Requisitos

- **Node.js** 20 ou superior
- Uma instância do **servidor LightRAG** acessível por HTTP(S) (por exemplo `lightrag-hku[api]` / `lightrag-server`)

## Instalação (npm)

Quando o pacote estiver publicado:

```bash
npx pw2c-lightrag-server-mcp
```

Ou instalação global:

```bash
npm install -g pw2c-lightrag-server-mcp
```

## Variáveis de ambiente

| Variável              | Obrigatória | Descrição                                                    |
| --------------------- | ----------- | ------------------------------------------------------------ |
| `LIGHTRAG_SERVER_URL` | Não         | URL base do LightRAG (predefinição: `http://localhost:9621`) |
| `LIGHTRAG_API_KEY`    | Não         | Se o servidor exigir, enviada como `X-API-Key`               |
| `LIGHTRAG_TIMEOUT_MS` | Não         | Timeout HTTP em ms (predefinição: `30000`)                   |

**Upload por path:** o ficheiro tem de estar **dentro do diretório de trabalho** do processo do MCP (sem path traversal para fora). Para conteúdo arbitrário, use **base64** no parâmetro `file` da tool `upload_document`.

## Configuração no Cursor (pacote publicado)

No ficheiro de MCP do Cursor (por exemplo `.cursor/mcp.json` na raiz do projeto ou configuração global de MCP), use:

```json
{
  "mcpServers": {
    "pw2c_lightrag": {
      "command": "npx",
      "args": ["pw2c-lightrag-server-mcp"],
      "env": {
        "LIGHTRAG_SERVER_URL": "https://seu-lightrag.exemplo.com",
        "LIGHTRAG_API_KEY": "sua-chave"
      }
    }
  }
}
```

Reinicie o Cursor ou recarregue os servidores MCP após alterar a configuração.

---

## Desenvolvimento e teste local (sem publicar no npm)

Pode ligar **outro projeto** no Cursor ao MCP **deste repositório clonado**, sem `npm publish`.

### 1. Preparar o build neste repositório

```bash
cd /caminho/para/pw2c-lightrag-server-mcp
npm install
npm run build
```

Confirme que existe `dist/cli.js` (ponto de entrada do binário).

### 2. Opção A — `node` com caminho absoluto (recomendado)

No projeto **onde quer usar o MCP** (ou na configuração global do Cursor), aponte diretamente para o ficheiro compilado:

**Windows (exemplo):**

```json
{
  "mcpServers": {
    "pw2c_lightrag_local": {
      "command": "node",
      "args": [
        "C:\\repositories\\healthdev\\pw2c-lightrag-server-mcp\\dist\\cli.js"
      ],
      "env": {
        "LIGHTRAG_SERVER_URL": "http://localhost:9621",
        "LIGHTRAG_API_KEY": "opcional"
      }
    }
  }
}
```

**macOS / Linux (exemplo):**

```json
{
  "mcpServers": {
    "pw2c_lightrag_local": {
      "command": "node",
      "args": ["/home/voce/projetos/pw2c-lightrag-server-mcp/dist/cli.js"],
      "env": {
        "LIGHTRAG_SERVER_URL": "http://localhost:9621",
        "LIGHTRAG_API_KEY": "opcional"
      }
    }
  }
}
```

Substitua o caminho pelo caminho real do clone no seu disco. Em JSON use `\\` em caminhos Windows ou `/` (o Node aceita em muitos casos).

### 3. Opção B — `npx` a partir da pasta do clone

Se estiver na pasta deste repositório, pode testar no terminal:

```bash
npx .
```

Para o Cursor, pode usar `npx` com o **caminho do pacote** (pasta que contém `package.json`):

```json
{
  "mcpServers": {
    "pw2c_lightrag_local": {
      "command": "npx",
      "args": [
        "--prefix",
        "C:\\repositories\\healthdev\\pw2c-lightrag-server-mcp",
        "pw2c-lightrag-server-mcp"
      ],
      "env": {
        "LIGHTRAG_SERVER_URL": "http://localhost:9621"
      }
    }
  }
}
```

Ajuste `--prefix` ao caminho absoluto do clone. Isto usa o `node_modules` e o `bin` definidos nesse pacote.

### 4. Opção C — desenvolvimento com `tsx` (sem build)

Para iterar só em TypeScript (mais lento a arrancar que `dist/cli.js`):

```json
{
  "mcpServers": {
    "pw2c_lightrag_dev": {
      "command": "npx",
      "args": [
        "tsx",
        "C:\\repositories\\healthdev\\pw2c-lightrag-server-mcp\\src\\cli.ts"
      ],
      "cwd": "C:\\repositories\\healthdev\\pw2c-lightrag-server-mcp",
      "env": {
        "LIGHTRAG_SERVER_URL": "http://localhost:9621"
      }
    }
  }
}
```

Confirme na documentação do Cursor se a chave `cwd` é suportada na sua versão; se não for, remova `cwd` e use caminhos absolutos em `args`.

### 5. Verificar

1. Arranque o LightRAG na URL configurada.
2. No Cursor, confirme que o servidor MCP aparece como ligado.
3. Use **Listar ferramentas** / pedidos ao agente que invoquem tools como `get_health` ou `query_text`.

Sempre que alterar código TypeScript, volte a correr `npm run build` se usar a **Opção A** ou **B**.

## Ferramentas expostas (resumo)

Alinhadas ao conjunto típico do [lightragmcp](https://github.com/lalitsuryan/lightragmcp) / `index.js`:

**Documentos:** `insert_text`, `insert_texts`, `upload_document`, `scan_documents`, `get_documents`, `get_documents_paginated`, `delete_document`, `clear_documents`, `reprocess_failed_documents`, `cancel_pipeline`

**Consultas:** `query_text`, `query_text_stream`, `query_data`

**Grafo:** `get_knowledge_graph`, `get_graph_labels`, `get_popular_labels`, `search_labels`, `check_entity_exists`, `create_entity`, `update_entity`, `delete_entity`, `create_relation`, `update_relation`, `delete_relation`, `merge_entities`

**Sistema:** `get_pipeline_status`, `get_track_status`, `get_document_status_counts`, `clear_cache`, `get_health`

Para detalhes do contrato HTTP e armadilhas (upload, NDJSON, etc.), veja [docs/specs/lightrag-mcp-servidor.spec.md](docs/specs/lightrag-mcp-servidor.spec.md).

## Scripts do repositório

| Comando                    | Descrição                                                                       |
| -------------------------- | ------------------------------------------------------------------------------- |
| `npm run build`            | Gera `dist/cli.js` (tsup)                                                       |
| `npm run dev`              | Executa `src/cli.ts` com tsx                                                    |
| `npm test`                 | Testes Vitest                                                                   |
| `npm run test:coverage`    | Testes com cobertura                                                            |
| `npm run lint`             | ESLint + Prettier check                                                         |
| `npm run typecheck`        | `tsc --noEmit`                                                                  |
| `npm run package:check`    | `npm pack --dry-run` (ficheiros do pacote)                                      |
| `npm run changeset`        | [Changesets](https://github.com/changesets/changesets): criar nota de alteração |
| `npm run version-packages` | Aplicar versões e atualizar `CHANGELOG.md`                                      |
| `npm run release`          | Publicar no npm (`changeset publish`)                                           |

## Versões e release (Changesets)

O fluxo é o mesmo do repositório [l-pw2c](https://github.com/healthdevio/skills-pw2c) ([`@changesets/cli`](https://github.com/changesets/changesets)):

1. **`npm run changeset`** — descreve a alteração (major / minor / patch); gera um ficheiro em `.changeset/`.
2. Após merge na branch principal, **`npm run version-packages`** — incrementa `version` no `package.json`, consome os changesets e atualiza o `CHANGELOG.md`.
3. **`npm run release`** — publica no registo npm (requer `npm login` e permissões no pacote).

A versão exposta no protocolo MCP (`McpServer`) é lida em tempo de execução a partir do `package.json` ([`src/version.ts`](src/version.ts)).

## Documentação adicional

- Resumo das ferramentas MCP: [TOOLS_SUMMARY.md](TOOLS_SUMMARY.md)
- Especificação interna e paridade com a API: [docs/specs/lightrag-mcp-servidor.spec.md](docs/specs/lightrag-mcp-servidor.spec.md)
- OpenAPI de referência (cópia local): [docs/openapi.json](docs/openapi.json)

## Licença

[MIT](LICENSE)

## Créditos

- Inspirado no servidor MCP [lalitsuryan/lightragmcp](https://github.com/lalitsuryan/lightragmcp) e no ecossistema [LightRAG](https://github.com/HKUDS/LightRAG).
