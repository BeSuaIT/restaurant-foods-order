/* ------------------------------------------------------------------ *
 *  Lưu trữ token + client HTTP
 *  (tách từ api.ts cũ — 1 file gộp cả token, HTTP, format, hook)
 * ------------------------------------------------------------------ */

const TABLE_TOKEN_KEY = 'ttth_table_token';
const STAFF_TOKEN_KEY = 'ttth_staff_token';

export const tokenStore = {
  getTableToken: (): string | null => localStorage.getItem(TABLE_TOKEN_KEY),
  setTableToken: (t: string) => localStorage.setItem(TABLE_TOKEN_KEY, t),
  clearTableToken: () => localStorage.removeItem(TABLE_TOKEN_KEY),

  getStaffToken: (): string | null => localStorage.getItem(STAFF_TOKEN_KEY),
  setStaffToken: (t: string) => localStorage.setItem(STAFF_TOKEN_KEY, t),
  clearStaffToken: () => localStorage.removeItem(STAFF_TOKEN_KEY),
};

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, message: string, code = 'ERROR', details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ReqOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  tableToken?: string | null;
  staffToken?: string | null;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: ReqOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const staffToken = opts.staffToken ?? tokenStore.getStaffToken();
  const tableToken = opts.tableToken ?? tokenStore.getTableToken();
  if (staffToken) headers['Authorization'] = `Bearer ${staffToken}`;
  if (tableToken) headers['x-table-token'] = tableToken;

  const res = await fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!res.ok) {
    const p = payload as { message?: string; code?: string; details?: unknown } | null;
    throw new ApiError(res.status, p?.message ?? `Lỗi ${res.status}`, p?.code, p?.details);
  }

  const body = payload as { data?: T } | null;
  return (body?.data ?? (payload as T)) as T;
}

export const api = {
  get: <T,>(path: string, o: ReqOptions = {}) => request<T>(path, { ...o, method: 'GET' }),
  post: <T,>(path: string, body?: unknown, o: ReqOptions = {}) => request<T>(path, { ...o, method: 'POST', body }),
  patch: <T,>(path: string, body?: unknown, o: ReqOptions = {}) => request<T>(path, { ...o, method: 'PATCH', body }),
  del: <T,>(path: string, o: ReqOptions = {}) => request<T>(path, { ...o, method: 'DELETE' }),
};