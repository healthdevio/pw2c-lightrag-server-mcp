import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { loadConfigFromEnv } from "./config.js";
import {
  createLightragClient,
  LightragHttpError,
  type LightragClient,
  type LightragClientOptions,
} from "./lightrag-client.js";
import { readPackageJsonVersion } from "./version.js";

const queryModeEnum = z.enum(["naive", "local", "global", "hybrid", "mix"]);

function resolveClientOptions(
  deps?: Partial<LightragClientOptions>,
): LightragClientOptions {
  if (deps?.baseUrl) {
    return {
      baseUrl: deps.baseUrl,
      apiKey: deps.apiKey,
      fetchFn: deps.fetchFn,
      timeoutMs: deps.timeoutMs,
      cwd: deps.cwd,
    };
  }
  const c = loadConfigFromEnv();
  return {
    baseUrl: c.baseUrl,
    apiKey: c.apiKey,
    fetchFn: deps?.fetchFn,
    timeoutMs: deps?.timeoutMs ?? c.timeoutMs,
    cwd: deps?.cwd,
  };
}

function jsonText(data: unknown): string {
  return typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function formatError(err: unknown): { text: string; isError: true } {
  if (err instanceof z.ZodError) {
    const msg = err.issues.map((i) => i.message).join("; ");
    return { text: `Validation: ${msg}`, isError: true };
  }
  if (err instanceof LightragHttpError) {
    return {
      text: `Error: ${err.message}\n${err.responseBody}`,
      isError: true,
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { text: `Error: ${msg}`, isError: true };
}

/**
 * Create MCP server proxying LightRAG HTTP API (stdio transport connected separately).
 */
export function createMcpServer(
  deps?: Partial<LightragClientOptions>,
): McpServer {
  const opts = resolveClientOptions(deps);
  const client: LightragClient = createLightragClient(opts);

  const server = new McpServer({
    name: "pw2c-lightrag-server-mcp",
    version: readPackageJsonVersion(),
  });

  const registerZod = <T>(
    name: string,
    description: string,
    schema: z.ZodType<T>,
    run: (args: T) => Promise<unknown>,
    /** Shape exposto ao cliente MCP quando o schema usa .transform() */
    mcpInputShape?: Record<string, z.ZodType>,
  ): void => {
    const inputSchema =
      mcpInputShape ??
      (schema instanceof z.ZodObject
        ? (schema.shape as Record<string, z.ZodType>)
        : {});
    server.registerTool(name, { description, inputSchema }, async (args) => {
      try {
        const parsed = schema.parse(args);
        const out = await run(parsed);
        return {
          content: [{ type: "text", text: jsonText(out) }],
        };
      } catch (e) {
        const { text, isError } = formatError(e);
        return {
          content: [{ type: "text", text }],
          isError,
        };
      }
    });
  };

  const emptySchema = z.object({});

  // —— Documents (10) ——
  registerZod(
    "insert_text",
    "Insert a single text document into LightRAG",
    z.object({
      text: z.string(),
      file_source: z.string().default("text_input.txt"),
    }),
    (p) =>
      client.postJson("/documents/text", {
        text: p.text,
        file_source: p.file_source,
      }),
  );

  registerZod(
    "insert_texts",
    "Insert multiple text documents into LightRAG in batch",
    z
      .object({
        texts: z.array(z.string()),
        file_sources: z.array(z.string()).optional(),
      })
      .transform((data) => ({
        texts: data.texts,
        file_sources:
          data.file_sources ??
          data.texts.map((_, i) => `text_input_${String(i + 1)}.txt`),
      })),
    (p) => client.postJson("/documents/texts", p),
    {
      texts: z.array(z.string()),
      file_sources: z.array(z.string()).optional(),
    },
  );

  registerZod(
    "upload_document",
    "Upload a document: local file path (under cwd) or base64-encoded bytes",
    z.object({ file: z.string() }),
    (p) => client.postMultipartUpload(p.file),
  );

  registerZod(
    "scan_documents",
    "Scan for new documents in the configured directory",
    emptySchema,
    () => client.postNoBody("/documents/scan"),
  );

  registerZod(
    "get_documents",
    "Retrieve all documents from LightRAG",
    emptySchema,
    () => client.getJson("/documents"),
  );

  registerZod(
    "get_documents_paginated",
    "Retrieve documents with pagination",
    z.object({
      page: z.number().default(1),
      page_size: z.number().default(50),
    }),
    (p) => client.postJson("/documents/paginated", p),
  );

  registerZod(
    "delete_document",
    "Delete specific documents by IDs",
    z.object({ doc_ids: z.array(z.string()) }),
    (p) => client.deleteJson("/documents/delete_document", p),
  );

  registerZod(
    "clear_documents",
    "Clear all documents from LightRAG",
    emptySchema,
    () => client.deleteJson("/documents"),
  );

  registerZod(
    "reprocess_failed_documents",
    "Reprocess failed and pending documents",
    emptySchema,
    () => client.postJson("/documents/reprocess_failed", {}),
  );

  registerZod(
    "cancel_pipeline",
    "Cancel the currently running pipeline",
    emptySchema,
    () => client.postJson("/documents/cancel_pipeline", {}),
  );

  // —— Query (3) ——
  registerZod(
    "query_text",
    "Query LightRAG with text using various retrieval modes",
    z.object({
      query: z.string(),
      mode: queryModeEnum.default("hybrid"),
      only_need_context: z.boolean().default(false),
      top_k: z.number().default(60),
    }),
    (p) => client.postJson("/query", p),
  );

  registerZod(
    "query_text_stream",
    "Stream query results from LightRAG (NDJSON aggregated)",
    z.object({
      query: z.string(),
      mode: queryModeEnum.default("hybrid"),
    }),
    (p) =>
      client.postQueryStream({
        query: p.query,
        mode: p.mode,
        stream: true,
      }),
  );

  registerZod(
    "query_data",
    "Get raw retrieval data without full LLM answer",
    z.object({
      query: z.string(),
      mode: queryModeEnum.default("hybrid"),
    }),
    (p) => client.postJson("/query/data", p),
  );

  // —— Graph (12) ——
  registerZod(
    "get_knowledge_graph",
    "Retrieve knowledge graph for a specific label or all entities",
    z.object({
      label: z.string().default("*"),
      max_depth: z.number().default(3),
      max_nodes: z.number().default(1000),
    }),
    (p) => client.getJsonWithParams("/graphs", p),
  );

  registerZod("get_graph_labels", "Get all graph labels", emptySchema, () =>
    client.getJson("/graph/label/list"),
  );

  registerZod(
    "get_popular_labels",
    "Get popular labels by node degree",
    z.object({ limit: z.number().default(300) }),
    (p) => client.getJsonWithParams("/graph/label/popular", p),
  );

  registerZod(
    "search_labels",
    "Search labels with fuzzy matching",
    z.object({
      q: z.string(),
      limit: z.number().default(50),
    }),
    (p) => client.getJsonWithParams("/graph/label/search", p),
  );

  registerZod(
    "check_entity_exists",
    "Check if an entity exists in the knowledge graph",
    z.object({ name: z.string() }),
    (p) => client.getJsonWithParams("/graph/entity/exists", { name: p.name }),
  );

  registerZod(
    "create_entity",
    "Create a new entity in the knowledge graph",
    z.object({
      entity_name: z.string(),
      entity_data: z.record(z.string(), z.unknown()),
    }),
    (p) => client.postJson("/graph/entity/create", p),
  );

  registerZod(
    "update_entity",
    "Update an entity in the knowledge graph",
    z.object({
      entity_name: z.string(),
      updated_data: z.record(z.string(), z.unknown()),
      allow_rename: z.boolean().default(false),
      allow_merge: z.boolean().default(false),
    }),
    (p) => client.postJson("/graph/entity/edit", p),
  );

  registerZod(
    "delete_entity",
    "Delete an entity from the knowledge graph",
    z.object({ entity_name: z.string() }),
    (p) => client.deleteJson("/documents/delete_entity", p),
  );

  registerZod(
    "create_relation",
    "Create a new relationship between entities",
    z.object({
      source_entity: z.string(),
      target_entity: z.string(),
      relation_data: z.record(z.string(), z.unknown()),
    }),
    (p) => client.postJson("/graph/relation/create", p),
  );

  registerZod(
    "update_relation",
    "Update a relationship in the knowledge graph",
    z.object({
      source_id: z.string(),
      target_id: z.string(),
      updated_data: z.record(z.string(), z.unknown()),
    }),
    (p) => client.postJson("/graph/relation/edit", p),
  );

  registerZod(
    "delete_relation",
    "Delete a relationship from the knowledge graph",
    z.object({
      source_entity: z.string(),
      target_entity: z.string(),
    }),
    (p) => client.deleteJson("/documents/delete_relation", p),
  );

  registerZod(
    "merge_entities",
    "Merge multiple entities into a single entity",
    z.object({
      entities_to_change: z.array(z.string()),
      entity_to_change_into: z.string(),
    }),
    (p) => client.postJson("/graph/entities/merge", p),
  );

  // —— System (5) ——
  registerZod(
    "get_pipeline_status",
    "Get the processing pipeline status",
    emptySchema,
    () => client.getJson("/documents/pipeline_status"),
  );

  registerZod(
    "get_track_status",
    "Get track status by ID",
    z.object({ track_id: z.string() }),
    (p) => client.getJson(`/documents/track_status/${p.track_id}`),
  );

  registerZod(
    "get_document_status_counts",
    "Get document status counts",
    emptySchema,
    () => client.getJson("/documents/status_counts"),
  );

  registerZod("clear_cache", "Clear LightRAG internal cache", emptySchema, () =>
    client.postJson("/documents/clear_cache", {}),
  );

  registerZod(
    "get_health",
    "Check LightRAG server health status",
    emptySchema,
    () => client.getJson("/health"),
  );

  return server;
}
