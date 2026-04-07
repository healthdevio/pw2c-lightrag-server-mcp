# LightRAG e servidores MCP: análise do problema e guia para um MCP próprio com paridade da API

Este documento explica **porque** o pacote/repositório [lightragmcp](https://github.com/lalitsuryan/lightragmcp) (`@g99/lightrag-mcp-server`) falha em cenários concretos (especialmente upload de ficheiros), como isso se relaciona com a **API HTTP oficial** do [LightRAG (HKUDS)](https://github.com/HKUDS/LightRAG), e que passos seguir para **reutilizar o código** desse repositório e construir um **servidor MCP** que cubra **todas** (ou quase todas) as capacidades expostas pelo servidor LightRAG.

Documentação do LightRAG

- [Redoc](https://lightrag-dev-mcp.docuscan.com.br/redoc#tag/documents)
- [Swagger](https://lightrag-dev-mcp.docuscan.com.br/webui/)
- [JSON openapi](https://lightrag-dev-mcp.docuscan.com.br/openapi.json) ou `./openapi.json`

---

## 1. Objetivo e âmbito

- **Objetivo**: ter um servidor MCP que exponha, de forma fiável, as operações do LightRAG (documentos, pipeline, consultas, grafo, sistema).
- **Referência de verdade**: o código da API FastAPI em `lightrag/api/routers/` do repositório **HKUDS/LightRAG** (versão que corre no vosso ambiente; alinhar sempre com essa versão).
- **Referência de partida**: [lalitsuryan/lightragmcp](https://github.com/lalitsuryan/lightragmcp) — implementação Node que faz de **cliente HTTP** para o LightRAG e de **servidor MCP** para o cliente (Cursor, Claude Desktop, etc.).

---

## 2. Arquitetura em três camadas

```text
┌─────────────────┐     stdio/SSE      ┌──────────────────────┐     HTTP (REST)    ┌─────────────────┐
│ Cliente MCP     │ ◄────────────────► │ Servidor MCP         │ ◄────────────────► │ LightRAG Server │
│ (IDE, agente)   │   MCP (JSON-RPC)   │ (Node/Python/…)      │   JSON / multipart │ (FastAPI :9621) │
└─────────────────┘                    └──────────────────────┘                    └─────────────────┘
```

Pontos importantes:

1. O **MCP** não envia ficheiros para o LightRAG diretamente; quem fala com o LightRAG é o **processo do servidor MCP** via HTTP.
2. Um **path de ficheiro** só funciona se o processo MCP **consegue ler** esse path **na máquina onde corre**. Se o LightRAG estiver noutro host/container, o path do teu PC **não existe** lá — só faz sentido upload por **bytes** (multipart ou texto/base64 processado no MCP).

---

## 3. Problema principal: `upload_document` e o contrato HTTP real

### 3.1 O que o LightRAG espera

No router de documentos, o endpoint de upload está definido com **`UploadFile` e `File(...)`**, ou seja, **multipart/form-data** com um campo de formulário chamado **`file`** contendo o binário do ficheiro.

Trecho conceitual da assinatura (código fonte: `lightrag/api/routers/document_routes.py` no [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG)):

- Rota: **`POST /documents/upload`**
- Parâmetro: `file: UploadFile = File(...)`
- Comportamento: validação de extensão, limites de tamanho (`MAX_UPLOAD_SIZE`), escrita no diretório de input, processamento assíncrono, resposta com `track_id`.

Ou seja: **não** é um corpo JSON `{ "file": "..." }`.

### 3.2 O que o lightragmcp faz hoje

No `index.js` do repositório lightragmcp:

1. O cliente **axios** é criado com cabeçalho por defeito **`Content-Type: application/json`**.
2. A ferramenta `upload_document` executa algo equivalente a:
   - `POST /documents/upload` com corpo JSON `{ file: args.file }`, onde `args.file` é uma **string** (documentado como path ou Base64, mas **sem** leitura de disco nem descodificação explícita no fluxo mostrado).

Consequências:

| Aspeto                        | LightRAG (FastAPI)     | lightragmcp (implementação típica)             |
| ----------------------------- | ---------------------- | ---------------------------------------------- |
| Content-Type                  | `multipart/form-data`  | `application/json`                             |
| Campo do ficheiro             | Parte multipart `file` | Propriedade JSON `file` (string)               |
| Preenchimento de `UploadFile` | Sim                    | Não — parâmetro `File` fica vazio              |
| Resposta HTTP típica          | 200 com `track_id`     | **422** (erro de validação: ficheiro em falta) |

O **422** é coerente com o FastAPI: o endpoint exige um upload multipart e a requisição não fornece o ficheiro no formato esperado.

### 3.3 Correção técnica (lado servidor MCP)

Para alinhar com o LightRAG:

1. Para **`POST /documents/upload`**, **não** enviar JSON com o cliente que força `Content-Type: application/json`.
2. Construir **`FormData`** (Node: `form-data` ou `FormData` nativo recente) e anexar o ficheiro com o nome do campo **`file`**.
3. Obter os bytes de uma destas fontes:
   - **Path local** lido no host onde o MCP corre: `fs.createReadStream(path)` ou buffer.
   - **Base64**: descodificar para `Buffer` e anexar com um `filename` plausível (a API valida extensões suportadas).
4. Manter **`X-API-Key`** (ou o esquema de auth que o vosso LightRAG usar) nos pedidos autenticados.
5. Deixar o axios **definir automaticamente** o `Content-Type` com boundary para multipart (remover `Content-Type` fixo nesse pedido).

### 3.4 Limitação operacional (mesmo com código corrigido)

- **Path remoto**: se o utilizador passar `C:\Users\...\doc.pdf` mas o processo Node do MCP corre noutro sítio, a leitura falha.
- **LightRAG noutro container**: o upload sempre grava no **filesystem do servidor LightRAG** (diretório de input configurado lá). O MCP apenas envia bytes; não “monta” o teu disco no servidor.

Para integração IDE → LightRAG remoto, opções robustas são: **`insert_text` / `insert_texts`** (conteúdo no corpo), ou upload multipart **a partir do processo que tem o ficheiro**.

---

## 4. Outras armadilhas ao reutilizar o lightragmcp

### 4.1 Cliente HTTP único com `Content-Type: application/json`

Qualquer ferramenta que precise de **multipart** ou de **corpo vazio** com método especial deve:

- usar um **segundo** axios/fetch sem header global de JSON, ou
- por pedido: apagar/sobrescrever `Content-Type` e passar `FormData` / `Buffer`.

### 4.2 Documentação vs código

O README do lightragmcp (e ficheiros como `API_REFERENCE.md`) **podem divergir** dos nomes de parâmetros no `index.js` (ex.: `file_path` vs `file`, formatos de `insert_texts`). Tratar o **código do lightragmcp** e o **OpenAPI / routers do LightRAG** como fontes a reconciliar, não só o README.

### 4.3 `insert_texts`

Na API HKUDS, `InsertTextsRequest` alinha com listas `texts` e `file_sources`. O schema MCP deve refletir **strings** (e opcionalmente `file_sources` paralelos), não objetos arbitrários, salvo o servidor LightRAG aceitar outro formato na vossa versão.

### 4.4 `delete_document`

A API usa **`DELETE /documents/delete_document`** com corpo (`doc_ids`, e frequentemente opções como eliminar ficheiro em disco e cache LLM). O lightragmcp envia `doc_ids`; confirme na vossa versão se existem campos extra que querem expor no MCP (`delete_file`, `delete_llm_cache`, etc.).

### 4.5 Consultas: modo por omissão e parâmetros avançados

O modelo `QueryRequest` no LightRAG inclui muitos campos opcionais (`only_need_prompt`, `response_type`, `chunk_top_k`, `conversation_history`, `hl_keywords` / `ll_keywords`, `include_references`, `include_chunk_content`, `enable_rerank`, limites de tokens, etc.). O lightragmcp expõe um **subconjunto** (por exemplo `query`, `mode`, `only_need_context`, `top_k`). Para **paridade**, o MCP próprio deve mapear estes campos para o JSON do `/query`, `/query/stream` e `/query/data`.

### 4.6 `query_text_stream`

O endpoint **`POST /query/stream`** devolve **`application/x-ndjson`**: várias linhas JSON. Um cliente MCP baseado em “uma única resposta JSON” pode precisar de **agregar** linhas ou expor streaming de forma explícita (buffer + join, ou ferramenta dedicada que devolve texto concatenado com aviso de formato).

### 4.7 Versão do LightRAG

Rotas e modelos mudam entre versões. Fixar a versão (`lightrag-hku[api]` no servidor) e gerar ou consultar o **OpenAPI** dessa instância (`/docs` ou `/openapi.json`) é o método mais seguro para **paridade 1:1**.

---

## 5. Inventário da API HTTP LightRAG (HKUDS, routers principais)

A lista abaixo resume rotas úteis para **espelhar no MCP**. Prefixos reais dependem de como a app monta os routers (tipicamente `/documents/*`, `/query*`, paths de grafo sem prefixo `/documents` — conforme `lightrag/api`).

### 5.1 Documentos (`document_routes.py`, prefixo `/documents`)

| Método | Caminho (relativo ao prefixo) | Função resumida                                |
| ------ | ----------------------------- | ---------------------------------------------- |
| POST   | `/scan`                       | Disparar scan do diretório de input            |
| POST   | `/upload`                     | **Multipart** — upload de ficheiro             |
| POST   | `/text`                       | Inserir um texto (`file_source`, `text`)       |
| POST   | `/texts`                      | Inserir vários textos                          |
| DELETE | `(raiz)/documents`            | Limpar todos os documentos                     |
| GET    | `/pipeline_status`            | Estado do pipeline                             |
| GET    | `/list_status`                | Listagem por estados (deprecated; limite 1000) |
| DELETE | `/delete_document`            | Apagar por `doc_ids` (+ opções no corpo)       |
| POST   | `/clear_cache`                | Limpar cache LLM                               |
| DELETE | `/delete_entity`              | Apagar entidade do grafo                       |
| DELETE | `/delete_relation`            | Apagar relação                                 |
| GET    | `/track_status/{track_id}`    | Estado por `track_id`                          |
| POST   | `/paginated`                  | Documentos paginados + filtros/ordenação       |
| GET    | `/status_counts`              | Contagens por estado                           |
| POST   | `/reprocess_failed`           | Reprocessar falhados/pendentes                 |
| POST   | `/cancel_pipeline`            | Pedir cancelamento do pipeline                 |

### 5.2 Consultas (`query_routes.py`)

| Método | Caminho         | Notas                                                                                                                     |
| ------ | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/query`        | Resposta JSON (`response`, `references` opcional)                                                                         |
| POST   | `/query/stream` | NDJSON, streaming                                                                                                         |
| POST   | `/query/data`   | Dados estruturados (entidades, relações, chunks, referências) sem gerar resposta LLM completa da mesma forma que `/query` |

O corpo segue o modelo **`QueryRequest`** (campos extensos — ver secção 4.5).

### 5.3 Grafo (`graph_routes.py`)

Exemplos de rotas (prefixo conforme montagem da app; no código aparecem paths como `/graphs`, `/graph/...`):

| Método | Caminho                  | Função resumida                            |
| ------ | ------------------------ | ------------------------------------------ |
| GET    | `/graph/label/list`      | Listar labels                              |
| GET    | `/graph/label/popular`   | Labels populares                           |
| GET    | `/graph/label/search`    | Pesquisa de labels                         |
| GET    | `/graphs`                | Subgrafo / visualização (parâmetros query) |
| GET    | `/graph/entity/exists`   | Verificar entidade                         |
| POST   | `/graph/entity/create`   | Criar entidade                             |
| POST   | `/graph/entity/edit`     | Editar entidade                            |
| POST   | `/graph/relation/create` | Criar relação                              |
| POST   | `/graph/relation/edit`   | Editar relação                             |
| POST   | `/graph/entities/merge`  | Fundir entidades                           |

### 5.4 Outros routers (paridade “completa” do produto LightRAG Server)

O repositório HKUDS inclui ainda, entre outros:

- **`ollama_api.py`**: API compatível com Ollama — útil se quiserem expor chat via MCP noutro formato; é **paralela** ao conjunto documentos/query/grafo, não substitui o RAG estruturado.
- **`/health`**: health check (o lightragmcp já chama `get_health`).

Para “todas as funcionalidades LightRAG **no MCP**”, definam explicitamente se incluem **Ollama-compatible** e **WebUI** (normalmente não são necessários para um MCP de automação de código).

---

## 6. Cobertura do lightragmcp frente à API (resumo)

O lightragmcp cobre **bem** muitos endpoints já listados (texto, listagens, grafo básico, query, pipeline, cancelamento, etc.). Os maiores **gaps** para paridade e fiabilidade são:

1. **`/documents/upload`**: implementação incorreta (JSON vs multipart) — **bug funcional**.
2. **Consultas**: falta exposição MCP de vários campos de `QueryRequest` e possivelmente tratamento dedicado de NDJSON em `/query/stream`.
3. **`/documents/paginated`**: a API aceita filtros, ordenação e paginação; o MCP pode expor apenas `page`/`page_size` — **paridade parcial**.
4. **`/documents/delete_document`**: pode faltar opções avançadas no corpo.
5. **Rotas de grafo / query**: confirmar se alguma rota nova na vossa versão não está mapeada.

---

## 7. Plano recomendado para o vosso servidor MCP próprio

### 7.1 Base de código

- **Fork** ou copiar a estrutura do [lightragmcp](https://github.com/lalitsuryan/lightragmcp) (stdio MCP + lista de tools + switch que chama HTTP).
- Substituir gradualmente o cliente HTTP por uma camada **por endpoint** (funções pequenas: `uploadFile`, `postJson`, `deleteWithBody`) para não repetir erros de `Content-Type`.

### 7.2 Geração de tools a partir do OpenAPI (opcional mas escalável)

- Descarregar `openapi.json` da instância LightRAG que usam.
- Gerar ou validar automaticamente nomes de tools e schemas JSON Schema alinhados com **cada** operação — reduz drift quando atualizam o LightRAG.

### 7.3 Prioridades de implementação

1. **Corrigir multipart** em `upload` + teste com ficheiro `.txt` pequeno.
2. Alinhar **`delete_document`** e **`paginated`** com o corpo Pydantic real.
3. Estender **`query`**, **`query/stream`**, **`query/data`** com o máximo de campos de `QueryRequest`.
4. Cobrir **todas** as rotas de `graph_routes` que faltarem.
5. Documentar no README do MCP: **onde o MCP corre**, **paths válidos**, e **limites de tamanho**.

### 7.4 Testes

- Testes de integração contra um LightRAG de CI ou container local: upload multipart, insert text, query, delete, merge entities.
- Teste explícito que **falha** se alguém regressar a JSON em `/documents/upload`.

### 7.5 Segurança

- Nunca logar `LIGHTRAG_API_KEY`.
- Validar paths em ferramentas que leem disco (path traversal).
- Se expuserem o MCP à rede, tratar autenticação do lado MCP (o LightRAG já pode usar `X-API-Key`).

---

## 8. Referências

- Repositório MCP de referência: [lalitsuryan/lightragmcp](https://github.com/lalitsuryan/lightragmcp)
- Pacote npm mencionado no README: [`@g99/lightrag-mcp-server`](https://www.npmjs.com/package/@g99/lightrag-mcp-server)
- API e servidor oficiais: [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG)
  - Routers: `lightrag/api/routers/document_routes.py`, `query_routes.py`, `graph_routes.py`
- Documentação do servidor: [LightRAG-API-Server.md](https://github.com/HKUDS/LightRAG/blob/main/docs/LightRAG-API-Server.md) (pode estar ligeiramente desfasada do código — validar com OpenAPI da vossa build)

---

## 9. Conclusão

O “problema” do lightragmcp que invalida o **`upload_document`** não é um detalhe menor: é um **desalinhamento de protocolo HTTP** (JSON vs **multipart/form-data** com campo **`file`**). O resto do servidor MCP pode funcionar porque a maioria dos endpoints LightRAG usa JSON. Para **aproveitar o código** e ter **todas as funcionalidades** do LightRAG no MCP, o caminho é: tratar a API HKUDS como contrato, corrigir o upload, depois **estender** as tools para cobrir os campos e rotas que o lightragmcp ainda não expõe, idealmente validando contra a **versão exata** do servidor que utilizam.
