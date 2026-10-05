import { query, queryOne, type SqlParam } from '../db.js';
import { badRequest, notFound } from '../utils.js';
import type { Branch, DiscountCode, UserRole } from '../types.js';

/* ------------------------------------------------------------------ *
 *  PHẠM VI CƠ SỞ (chi nhánh)
 *
 *  Quy tắc:
 *   - Admin            : branch_id = null  -> xem TẤT CẢ cơ sở (có bộ lọc để lọc nhanh)
 *   - Nhân viên        : branch_id = <id>  -> chỉ thấy cơ sở của mình
 *   - Nhân viên chưa được gán cơ sở -> NO_BRANCH (không thấy gì)
 * ------------------------------------------------------------------ */

/** Giá trị gộp ràng buộc SQL: không lấy dòng nào. */
export const NO_BRANCH = -1;

/** Đối tượng tối thiểu cần để xác định phạm vi cơ sở. */
export interface BranchActor {
  staff?: { role: UserRole; branch_id: number | null } | undefined;
}

/**
 * branch_id người đang đăng nhập được phép xem.
 * null = tất cả cơ sở. NO_BRANCH = không được xem cơ sở nào.
 */
export function scopeBranchId(req: BranchActor): number | null {
  const s = req.staff;
  if (!s) return NO_BRANCH;
  if (s.role === 'admin') return null;
  return s.branch_id ?? NO_BRANCH;
}

/**
 * Bộ lọc cơ sở do người dùng chọn trên UI (chỉ Admin mới có tác dụng).
 * - Staff            : luôn bị ép về cơ sở của mình (bỏ qua tham số).
 * - Admin + không chọn: null = tất cả.
 * - Admin + chọn      : branch_id đó.
 */
export function effectiveBranchFilter(req: BranchActor, raw: unknown): number | null | 'none' {
  if (req.staff?.role !== 'admin') return scopeBranchId(req);
  if (raw === undefined || raw === null || raw === '' || raw === 'all') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'none';
  return Math.trunc(n);
}

/* ------------------------------------------------------------------ *
 *  Truy vấn cơ sở
 * ------------------------------------------------------------------ */

const BRANCH_SELECT = `
  SELECT b.id, b.name, b.address, b.phone, b.note, b.is_active, b.created_at,
         (SELECT COUNT(*) FROM rest_tables t WHERE t.branch_id = b.id)                          AS table_count,
         (SELECT COUNT(*) FROM users u      WHERE u.branch_id = b.id)                          AS user_count
    FROM branches b
`;

export async function listBranches(activeOnly = false): Promise<Branch[]> {
  return query<Branch>(
    `${BRANCH_SELECT} ${activeOnly ? 'WHERE b.is_active' : ''} ORDER BY b.name COLLATE "C"`,
  );
}

export async function getBranch(id: number): Promise<Branch | null> {
  return queryOne<Branch>(`${BRANCH_SELECT} WHERE b.id = $1`, [id]);
}

/** Đảm bảo branch_id tồn tại (nếu có), trả về id đã chuẩn hoá (null = tất cả). */
export async function requireBranch(value: unknown): Promise<number | null> {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw badRequest('Cơ sở không hợp lệ.');
  const b = await queryOne<{ id: number }>('SELECT id FROM branches WHERE id = $1', [Math.trunc(n)]);
  if (!b) throw notFound('Không tìm thấy cơ sở đã chọn.');
  return b.id;
}

/* ------------------------------------------------------------------ *
 *  Truy vấn mã giảm giá
 * ------------------------------------------------------------------ */

export async function listDiscountCodes(): Promise<DiscountCode[]> {
  return query<DiscountCode>(
    `SELECT id, code, description, percent, start_at, end_at, is_active, used_count, created_at
       FROM discount_codes
      ORDER BY is_active DESC, code COLLATE "C"`,
  );
}

export interface DiscountCheck {
  code: DiscountCode;
  /** Số tiền được giảm (đã làm tròn về đồng) */
  amount: number;
  /** Tổng sau giảm */
  total: number;
}

/** Chuẩn hoá mã: bỏ khoảng trắng, viết hoa không dấu. */
export function normalizeDiscountCode(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Kiểm tra mã giảm giá và tính tiền.
 * @param subtotal tổng tiền món (chưa giảm)
 */
export async function checkDiscountCode(rawCode: unknown, subtotal: number): Promise<DiscountCheck> {
  const code = normalizeDiscountCode(rawCode);
  if (!code) throw badRequest('Vui lòng nhập mã giảm giá.');

  const row = await queryOne<DiscountCode>(
    `SELECT id, code, description, percent, start_at, end_at, is_active, used_count, created_at
       FROM discount_codes
      WHERE upper(code) = $1`,
    [code],
  );
  if (!row) throw badRequest('Mã giảm giá không tồn tại.');
  if (!row.is_active) throw badRequest('Mã giảm giá đã ngừng hoạt động.');

  const now = Date.now();
  if (row.start_at && new Date(row.start_at).getTime() > now)
    throw badRequest(`Mã giảm giá chỉ áp dụng từ ${formatDate(row.start_at)}.`);
  if (row.end_at && new Date(row.end_at).getTime() < now)
    throw badRequest(`Mã giảm giá đã hết hạn (${formatDate(row.end_at)}).`);

  const sub = Math.max(0, Number(subtotal) || 0);
  const amount = Math.round((sub * row.percent) / 100);
  return { code: row, amount, total: Math.max(0, sub - amount) };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/* ------------------------------------------------------------------ *
 *  Tiện ích SQL
 * ------------------------------------------------------------------ */

/** Đẩy branchId +o params và trả về điều kiện SQL (dùng khi filter = null thì bỏ qua). */
export function pushBranchParam(
  params: SqlParam[],
  filter: number | null | 'none',
  column = 't.branch_id',
): string {
  if (filter === null) return '';
  params.push(filter);
  return ` AND ${column} = $${params.length}`;
}
