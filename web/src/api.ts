import { useCallback, useEffect, useRef, useState } from 'react';
import type { StaffUser } from './types';

export type { StaffUser };

/* ------------------------------------------------------------------ *
 *  Lưu trữ token
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

/* ------------------------------------------------------------------ *
 *  Client HTTP
 * ------------------------------------------------------------------ */

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

interface ReqOptions {
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

/* ------------------------------------------------------------------ *
 *  Định dạng
 * ------------------------------------------------------------------ */

const VND = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

export const formatMoney = (n: number | string | null | undefined): string => {
  const v = Number(n ?? 0);
  return VND.format(Number.isFinite(v) ? v : 0) + 'đ';
};

export const formatMoneyPlain = (n: number | string | null | undefined): string => {
  const v = Number(n ?? 0);
  return VND.format(Number.isFinite(v) ? v : 0);
};

export const formatTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
};

export const formatDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '—';
  const diff = Date.now() - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return formatDate(iso);
}

export function durationBetween(from: string | null, to: string | null): string {
  if (!from) return '—';
  const a = new Date(from).getTime();
  const b = to ? new Date(to).getTime() : Date.now();
  if (Number.isNaN(a) || Number.isNaN(b)) return '—';
  const mins = Math.max(0, Math.round((b - a) / 60000));
  if (mins < 60) return `${mins} phút`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}p` : `${h}h`;
}

export function initials(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ------------------------------------------------------------------ *
 *  Kiểm tra số điện thoại Việt Nam
 * ------------------------------------------------------------------ */

export function normalizeVnPhone(input: string): string {
  const raw = (input ?? '').replace(/[^\d+]/g, '');
  if (raw.startsWith('+84')) return '0' + raw.slice(3);
  if (raw.startsWith('84') && raw.length >= 11) return '0' + raw.slice(2);
  return raw.startsWith('0') ? raw : raw;
}

export function isValidVnPhone(input: string): boolean {
  return /^0\d{9,10}$/.test(normalizeVnPhone(input));
}

/* ------------------------------------------------------------------ *
 *  Hook: dữ liệu async đơn giản
 * ------------------------------------------------------------------ */

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (updater: T | ((prev: T | null) => T | null)) => void;
}

export interface AsyncOptions {
  /** false = chưa cần gọi API (VD: modal đang đóng) */
  enabled?: boolean;
}

export function useAsync<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[] = [],
  opts: AsyncOptions = {},
): AsyncState<T> {
  const enabled = opts.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setData(null);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    let alive = true;
    setLoading(true);
    fetcherRef
      .current(ctrl.signal)
      .then((res) => {
        if (!alive) return;
        setData(res);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Đã có lỗi xảy ra.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, enabled, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return {
    data,
    loading,
    error,
    reload,
    setData: (updater) =>
      setData((prev) => (typeof updater === 'function' ? (updater as (p: T | null) => T | null)(prev) : updater)),
  };
}

/* ------------------------------------------------------------------ *
 *  Hook: đăng nhập nhân viên / admin
 * ------------------------------------------------------------------ */

export function useStaffAuth() {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = tokenStore.getStaffToken();
    if (!token) {
      setReady(true);
      return;
    }
    let alive = true;
    api
      .get<StaffUser>('/auth/me', { staffToken: token })
      .then((u) => alive && setUser(u))
      .catch(() => tokenStore.clearStaffToken())
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const logout = useCallback(() => {
    tokenStore.clearStaffToken();
    setUser(null);
  }, []);

  return { user, ready, logout };
}

/* ------------------------------------------------------------------ *
 *  Hook: Server-Sent Events (cập nhật thời gian thực)
 * ------------------------------------------------------------------ */

export type StreamEvent =
  | { type: 'hello'; kind: 'staff' | 'table' }
  | { type: 'order.created' | 'order.updated' | 'order.paid' | 'order.cancelled'; orderNo: string; tableId: number | null; status: string }
  | { type: 'menu.updated' | 'table.updated' }
  /** Admin vừa đăng/gỡ một thông báo nội bộ */
  | { type: 'announcement.updated' }
  | { type: 'heartbeat' };

export function useLiveStream(token: string | null, onEvent: (e: StreamEvent) => void) {
  const [connected, setConnected] = useState(false);
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    if (!token) {
      setConnected(false);
      return;
    }
    let es: EventSource | null = null;
    let retry: number | undefined;
    let closed = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);

      es.addEventListener('open', () => setConnected(true));

      const types: StreamEvent['type'][] = [
        'hello',
        'order.created',
        'order.updated',
        'order.paid',
        'order.cancelled',
        'menu.updated',
        'table.updated',
        'heartbeat',
      ];
      for (const t of types) {
        es.addEventListener(t, (ev) => {
          try {
            cbRef.current(JSON.parse((ev as MessageEvent).data) as StreamEvent);
          } catch {
            /* bỏ qua gói tin lỗi */
          }
        });
      }

      es.addEventListener('error', () => {
        setConnected(false);
        es?.close();
        // EventSource tự reconnect, nhưng ta quản lý thủ công cho chắc chắn
        if (!closed) retry = window.setTimeout(connect, 4000);
      });
    };

    connect();

    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      es?.close();
    };
  }, [token]);

  return connected;
}
