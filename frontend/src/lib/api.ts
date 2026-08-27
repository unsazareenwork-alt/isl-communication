export const API_BASE = (
  (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:5000"
).replace(/\/+$/, "");

const SOCKET_ORIGIN = API_BASE;

/**
 * Central place to read the configured backend origin.
 * Socket.IO connects to the same server that serves the REST API.
 */
export function socketUrl(): string {
  return SOCKET_ORIGIN;
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * Shared helper that surfaces the backend's error message when present,
 * and falls back to a safe generic message otherwise.
 *
 * @param res - the raw fetch Response
 * @returns parsed JSON body
 */
async function readError(res: Response): Promise<ApiError> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // response was not JSON
  }
  const message =
    body && typeof body.error === "string" ? body.error : "Something went wrong. Please try again.";
  return new ApiError(res.status, message, body);
}

/**
 * Perform an authenticated (or public) JSON request against the backend.
 *
 * @param onUnauthorized - called when the backend returns 401 (e.g. map to auth session reset)
 */
export async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string | null;
    onUnauthorized?: () => void;
  } = {},
): Promise<T> {
  const { method = "GET", body, token, onUnauthorized } = options;

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) {
    onUnauthorized?.();
  }

  if (!res.ok) {
    throw await readError(res);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}
