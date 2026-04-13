export interface AppConfig {
  baseUrl: string;
  apiKey: string | undefined;
  timeoutMs: number;
  /** Workspace LightRAG por defeito (cabeçalho `LIGHTRAG-WORKSPACE`); sobrescrito pelo argumento `workspace` da tool. */
  defaultWorkspace: string | undefined;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("LIGHTRAG_SERVER_URL is empty");
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("LIGHTRAG_SERVER_URL must be http or https");
    }
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch (e) {
    if (e instanceof TypeError) {
      throw new Error(`LIGHTRAG_SERVER_URL is not a valid URL: ${raw}`, {
        cause: e,
      });
    }
    throw e;
  }
}

export function loadConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const rawUrl = env.LIGHTRAG_SERVER_URL ?? "http://localhost:9621";
  const baseUrl = normalizeBaseUrl(rawUrl);
  const apiKey = env.LIGHTRAG_API_KEY?.trim() || undefined;
  const timeoutRaw = env.LIGHTRAG_TIMEOUT_MS;
  const timeoutMs = timeoutRaw
    ? Number.parseInt(timeoutRaw, 10)
    : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error("LIGHTRAG_TIMEOUT_MS must be a positive number");
  }
  const ws = env.LIGHTRAG_WORKSPACE?.trim();
  const defaultWorkspace = ws && ws.length > 0 ? ws : undefined;
  return { baseUrl, apiKey, timeoutMs, defaultWorkspace };
}
