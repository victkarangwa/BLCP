/**
 * Single API client used by every page.
 *
 * Responsibilities (and the reasons each one exists here, not in components):
 *   - Send credentials (cookies) on every request.
 *   - Auto-attach X-CSRF-Token on mutating methods (read from bnr_csrf cookie).
 *   - Auto-set Content-Type: application/json (skipped for FormData).
 *   - Pass through Idempotency-Key for safe retries on creation endpoints.
 *   - Translate the standard error envelope into a typed ApiError.
 *
 * Why a function and not axios: no interceptor magic, no module init,
 * no global state. fetch is enough. Easy to test, easy to mock.
 */

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  idempotencyKey?: string;
}

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)bnr_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, idempotencyKey, headers: extraHeaders, ...rest } = options;

  const headers = new Headers(extraHeaders);
  const method = (rest.method ?? 'GET').toUpperCase();
  const isMutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

  if (body !== undefined && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (isMutating) {
    const csrf = getCsrfToken();
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  if (idempotencyKey) {
    headers.set('Idempotency-Key', idempotencyKey);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    credentials: 'include',
    headers,
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) return undefined as T;

  const payload: { error?: { code?: string; message?: string; details?: Record<string, unknown>; requestId?: string } } | T =
    await response.json().catch(() => ({}) as Record<string, never>);

  if (!response.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: Record<string, unknown>; requestId?: string } })?.error ?? {};
    throw new ApiError(
      response.status,
      err.code ?? 'UNKNOWN_ERROR',
      err.message ?? response.statusText,
      err.details,
      err.requestId,
    );
  }

  return payload as T;
}
