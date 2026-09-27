import type { components } from './schema';

export type Schemas = components['schemas'];

// On a phone, localhost is the phone itself: set EXPO_PUBLIC_API_URL to your computer's
// network address (e.g. http://192.168.1.20:8000). The Android emulator uses http://10.0.2.2:8000.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type AuthHandlers = {
  getAccessToken: () => string | null;
  // Returns a new access token, or null when the session can't be renewed
  refreshAccessToken: () => Promise<string | null>;
};

let authHandlers: AuthHandlers | null = null;

export function setAuthHandlers(handlers: AuthHandlers | null) {
  authHandlers = handlers;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  // Public endpoints like log in skip the Authorization header
  auth?: boolean;
  // Website only: send and receive the refresh token as an HttpOnly cookie
  refreshCookie?: boolean;
};

async function send(path: string, options: RequestOptions, token: string | null) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.refreshCookie) headers['X-Refresh-Cookie'] = '1';

  return fetch(`${API_URL}${path}${query ? `?${query}` : ''}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    // Other requests leave cookies out; the refresh cookie is only for /auth anyway
    credentials: options.refreshCookie ? 'include' : 'same-origin',
  });
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.detail === 'string') return data.detail;
  } catch {
    // Not JSON, fall through
  }
  return `Something went wrong (${response.status})`;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const useAuth = options.auth ?? true;
  let token = useAuth ? (authHandlers?.getAccessToken() ?? null) : null;

  let response: Response;
  try {
    response = await send(path, options, token);

    // Access tokens only last 30 minutes, so renew once and retry
    if (response.status === 401 && useAuth && authHandlers) {
      token = await authHandlers.refreshAccessToken();
      if (token) response = await send(path, options, token);
    }
  } catch {
    throw new ApiError(0, "Can't reach Triplet. Check your connection and try again.");
  }

  if (!response.ok) {
    throw new ApiError(response.status, await errorMessage(response));
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
