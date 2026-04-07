const LOCAL_BACKEND_FALLBACK = "http://127.0.0.1:8001";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
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

export const HEALTH_SMOKE_PATH = "/api/health";
