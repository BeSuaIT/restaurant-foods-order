import { randomBytes } from 'node:crypto';

/** Lỗi nghiệp vụ có mã HTTP */
export class HttpError extends Error {
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

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, 'BAD_REQUEST', details);
export const unauthorized = (msg = 'Bạn cần đăng nhập.') => new HttpError(401, msg, 'UNAUTHORIZED');
export const forbidden = (msg = 'Bạn không có quyền thực hiện thao tác này.') => new HttpError(403, msg, 'FORBIDDEN');
export const notFound = (msg = 'Không tìm thấy dữ liệu.') => new HttpError(404, msg, 'NOT_FOUND');
export const conflict = (msg: string) => new HttpError(409, msg, 'CONFLICT');

/** Làm tròn về 0đ để tránh lỗi số thập phân khi cộng dồn nhiều dòng */
export const money = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export const randomToken = (bytes = 24): string => randomBytes(bytes).toString('hex');

/** Sinh mã order dễ đọc: O-20261005-8F3A */
export function generateOrderNo(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const rand = randomBytes(3).toString('hex').toUpperCase();
  return `O-${y}${m}${d}-${rand}`;
}

/** Chuẩn hoá số điện thoại Việt Nam về dạng 0XXXXXXXXX */
export function normalizePhone(input: string): string {
  const raw = (input ?? '').replace(/[^\d+]/g, '');
  if (raw.startsWith('+84')) return '0' + raw.slice(3);
  if (raw.startsWith('84') && raw.length >= 11) return '0' + raw.slice(2);
  if (raw.startsWith('0')) return raw;
  return raw;
}

export function isValidVietnamPhone(input: string): boolean {
  const p = normalizePhone(input);
  return /^0\d{9,10}$/.test(p);
}

/** Escape ký tự để dùng trong LIKE (tránh % và _) */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

export function toInt(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Vòng lặp async không chặn (dùng cho SSE) */
export function safeHandler<T extends (...args: never[]) => Promise<unknown>>(fn: T) {
  return (...args: Parameters<T>) => {
    void fn(...args).catch((err) => console.error('[handler]', err));
  };
}
