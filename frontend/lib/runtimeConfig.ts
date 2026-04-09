const LOCAL_BACKEND_FALLBACK = "http://127.0.0.1:8001";
const INFERRED_BACKEND_PORT = process.env.NEXT_PUBLIC_BACKEND_PORT?.trim() || "8001";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function toWsBase(value: string): string {
  const isHttpsPage = typeof window !== "undefined" && window.location.protocol === "https:";

  let resolved = value;
  if (value.startsWith("ws://") || value.startsWith("wss://")) {
    resolved = value;
  } else if (value.startsWith("https://")) {
    resolved = `wss://${value.slice("https://".length)}`;
  } else if (value.startsWith("http://")) {
    resolved = `ws://${value.slice("http://".length)}`;
  } else {
    resolved = `ws://${value}`;
  }

  // Prevent mixed-content websocket errors when frontend is served over HTTPS.
  if (isHttpsPage && resolved.startsWith("ws://")) {
    return `wss://${resolved.slice("ws://".length)}`;
  }

  return resolved;
}

export function resolveBackendBase(): string {
  const envBase = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  if (envBase) {
    return trimTrailingSlash(envBase);
  }

  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return LOCAL_BACKEND_FALLBACK;
    }

    // For tablet/phone LAN access (e.g., host:3001), infer backend on same host:8001.
    if (window.location.port && window.location.port !== INFERRED_BACKEND_PORT) {
      return `${window.location.protocol}//${host}:${INFERRED_BACKEND_PORT}`;
    }

    // When no explicit backend is configured, same-origin deployment still works.
    return window.location.origin;
  }

  return "";
}

export function resolveWsBase(backendBase: string): string {
  const envWsBase = process.env.NEXT_PUBLIC_WS_BASE_URL?.trim();
  if (envWsBase) {
    return trimTrailingSlash(envWsBase);
  }

  if (backendBase) {
    return backendBase;
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "";
}

export function buildApiPath(path: string, backendBase: string): string {
  const normalizedPath = normalizePath(path);
  return backendBase ? `${trimTrailingSlash(backendBase)}${normalizedPath}` : normalizedPath;
}

export function buildWsPath(path: string, wsBase: string): string {
  const normalizedPath = normalizePath(path);
  const normalizedWsBase = trimTrailingSlash(wsBase);
  if (!normalizedWsBase) {
    return normalizedPath;
  }
  return `${toWsBase(normalizedWsBase)}${normalizedPath}`;
}

export const HEALTH_SMOKE_PATH = "/api/health";
