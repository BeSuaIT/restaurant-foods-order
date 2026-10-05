import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { query, queryOne, withTransaction, type SqlParam } from '../db.js';
import { config } from '../config.js';
import { hashPassword } from '../auth.js';
import { asyncRoute, ok } from '../middleware/errors.js';
import { requireAdmin, requireStaff } from '../middleware/auth.js';
import { badRequest, conflict, notFound, toInt } from '../utils.js';
import { bus } from '../bus.js';
import { listOrders, dashboardStats } from '../services/order.service.js';
import {
  DISCOUNT_COLUMNS,
  effectiveBranchFilter,
  getBranch,
  listBranches,
  listDiscountCodes,
  normalizeDiscountCode,
  parseCoordinate,
  requireBranch,
} from '../services/branch.js';
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncementsAdmin,
  parseAnnouncementInput,
  updateAnnouncement,
} from '../services/announcement.service.js';
import type { DiscountCode, OptionGroup, OptionItem, OrderStatus, RestTable } from '../types.js';

export const adminRouter = Router();

// Tất cả route dưới đây đều yêu cầu đăng nhập + quyền Admin
adminRouter.use(requireStaff, requireAdmin);

/**
 * Bộ lọc cơ sở cho Admin. Admin xem tất cả; thêm `?branch_id=<id>` để lọc.
 * Đẩy tham số vào `params` và trả về điều kiện SQL (rỗng nếu không lọc).
 */
interface BranchFilterReq {
  query: Record<string, unknown>;
  staff?: { role: 'admin' | 'staff'; branch_id: number | null };
}

function branchWhere(req: BranchFilterReq, params: SqlParam[], column = 't.branch_id') {
  const f = effectiveBranchFilter(req, req.query.branch_id);
  if (f === 'none') return ' AND 1 = 0';
  if (f == null) return '';
  params.push(f);
  return ` AND ${column} = $${params.length}`;
}

/* ================================================================== *
 *  0. CƠ SỞ (CHI NHÁNH) & MÃ GIẢM GIÁ — CÀI ĐẶT
 * ================================================================== */

const branchSchema = z.object({
  name: z.string().trim().min(1, 'Tên cơ sở không được để trống.').max(120),
  address: z.string().trim().max(300).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  note: z.string().trim().max(200).optional().nullable(),
  /** Tọa độ (chuỗi hoặc số đều nhận được) — chuẩn hoá lại trong route */
  lat: z.union([z.string(), z.number(), z.null()]).optional().nullable(),
  lng: z.union([z.string(), z.number(), z.null()]).optional().nullable(),
  is_active: z.boolean().default(true),
});

adminRouter.get(
  '/branches',
  asyncRoute(async (_req, res) => {
    ok(res, await listBranches());
  }),
);

adminRouter.post(
  '/branches',
  asyncRoute(async (req, res) => {
    const body = branchSchema.parse(req.body);
    const rows = await query<{ id: number }>(
      'INSERT INTO branches (name, address, phone, note, lat, lng, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [
        body.name,
        body.address || null,
        body.phone || null,
        body.note || null,
        parseCoordinate(body.lat, 'Vĩ độ', 90),
        parseCoordinate(body.lng, 'Kinh độ', 180),
        body.is_active,
      ],
    );
    ok(res, await getBranch(rows[0].id), 201);
  }),
);

adminRouter.patch(
  '/branches/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    const body = branchSchema.partial().parse(req.body);

    const sets: string[] = [];
    const params: SqlParam[] = [id];
    for (const key of ['name', 'address', 'phone', 'note', 'is_active'] as const) {
      if (body[key] !== undefined) {
        params.push(key === 'is_active' ? body[key] : (body[key] as string) || null);
        sets.push(`${key} = $${params.length}`);
      }
    }
    // Tọa độ: chuẩn hoá + kiểm tra khoảng (vĩ độ -90..90, kinh độ -180..180)
    if (body.lat !== undefined) {
      params.push(parseCoordinate(body.lat, 'Vĩ độ', 90));
      sets.push(`lat = $${params.length}`);
    }
    if (body.lng !== undefined) {
      params.push(parseCoordinate(body.lng, 'Kinh độ', 180));
      sets.push(`lng = $${params.length}`);
    }
    if (sets.length === 0) throw badRequest('Không có thông tin nào để cập nhật.');

    const rows = await query(`UPDATE branches SET ${sets.join(', ')} WHERE id = $1 RETURNING id`, params);
    if (rows.length === 0) throw notFound('Không tìm thấy cơ sở.');
    ok(res, await getBranch(id));
  }),
);

adminRouter.delete(
  '/branches/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    const b = await getBranch(id);
    if (!b) throw notFound('Không tìm thấy cơ sở.');

    const tables = b.table_count ?? 0;
    const users = b.user_count ?? 0;
    if (tables > 0 || users > 0) {
      // Còn bàn/nhân viên -> vô hiệu hoá thay vì xoá để không mất lịch sử order
      await query('UPDATE branches SET is_active = FALSE WHERE id = $1', [id]);
      ok(res, {
        soft_deleted: true,
        message: `Cơ sở còn ${tables} bàn và ${users} nhân viên nên chỉ bị vô hiệu hoá. Hãy chuyển bàn/nhân viên sang cơ sở khác trước khi xoá.`,
      });
      return;
    }

    await query('DELETE FROM branches WHERE id = $1', [id]);
    ok(res, { deleted: id });
  }),
);

/* ================================================================== *
 *  0b. MÃ GIẢM GIÁ
 * ================================================================== */

/** Ngày -> ISO. Chấp nhận "YYYY-MM-DD" (giờ Việt Nam) hoặc ISO đầy đủ. */
function toIsoDateTime(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00+07:00` : s;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} không hợp lệ.`);
  return d.toISOString();
}

const discountSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Mã giảm giá tối thiểu 2 ký tự.')
    .max(40)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Mã giảm giá chỉ gồm chữ, số, - và _'),
  description: z.string().trim().max(200).optional().nullable(),
  percent: z.coerce.number().int().min(0).max(100, 'Phần trăm giảm tối đa là 100.'),
  /** null / 0 = không giới hạn số lần dùng */
  usage_limit: z
    .union([z.coerce.number().int().min(0).max(1_000_000), z.literal(null), z.literal(0)])
    .optional()
    .nullable(),
  start_at: z.string().optional().nullable(),
  end_at: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});

function parseDiscountBody(raw: unknown): z.infer<typeof discountSchema> & {
  code: string;
  usage_limit: number | null;
  start_at: string | null;
  end_at: string | null;
} {
  const body = discountSchema.parse(raw);
  const start = toIsoDateTime(body.start_at, 'Ngày bắt đầu');
  const end = toIsoDateTime(body.end_at, 'Ngày kết thúc');
  if (start && end && new Date(start) > new Date(end)) {
    throw badRequest('Ngày kết thúc phải sau ngày bắt đầu.');
  }
  const limit = body.usage_limit == null || body.usage_limit === 0 ? null : body.usage_limit;
  return { ...body, code: normalizeDiscountCode(body.code), usage_limit: limit, start_at: start, end_at: end };
}

adminRouter.get(
  '/discount-codes',
  asyncRoute(async (_req, res) => {
    ok(res, await listDiscountCodes());
  }),
);

adminRouter.post(
  '/discount-codes',
  asyncRoute(async (req, res) => {
    const body = parseDiscountBody(req.body);
    const exists = await queryOne('SELECT 1 FROM discount_codes WHERE upper(code) = $1', [body.code]);
    if (exists) throw conflict('Mã giảm giá này đã tồn tại.');

    const rows = await query<DiscountCode>(
      `INSERT INTO discount_codes (code, description, percent, usage_limit, start_at, end_at, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING ${DISCOUNT_COLUMNS}`,
      [body.code, body.description || null, body.percent, body.usage_limit, body.start_at, body.end_at, body.is_active],
    );
    ok(res, rows[0], 201);
  }),
);

adminRouter.patch(
  '/discount-codes/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    const body = parseDiscountBody(req.body);

    const dup = await queryOne('SELECT 1 FROM discount_codes WHERE upper(code) = $1 AND id <> $2', [body.code, id]);
    if (dup) throw conflict('Mã giảm giá này đã tồn tại.');

    const rows = await query<DiscountCode>(
      `UPDATE discount_codes
          SET code=$2, description=$3, percent=$4, usage_limit=$5, start_at=$6, end_at=$7, is_active=$8
        WHERE id=$1
        RETURNING ${DISCOUNT_COLUMNS}`,
      [id, body.code, body.description || null, body.percent, body.usage_limit, body.start_at, body.end_at, body.is_active],
    );
    if (rows.length === 0) throw notFound('Không tìm thấy mã giảm giá.');
    ok(res, rows[0]);
  }),
);

adminRouter.delete(
  '/discount-codes/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    const used = await queryOne<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM orders WHERE discount_code_id = $1',
      [id],
    );
    if ((used?.count ?? 0) > 0) {
      // đã dùng trong đơn -> tắt thay vì xoá để giữ lịch sử bill
      await query('UPDATE discount_codes SET is_active = FALSE WHERE id = $1', [id]);
      ok(res, { soft_deleted: true, message: 'Mã đã dùng trên hóa đơn nên được ngừng hoạt động thay vì xoá.' });
      return;
    }
    const rows = await query('DELETE FROM discount_codes WHERE id = $1 RETURNING id', [id]);
    if (rows.length === 0) throw notFound('Không tìm thấy mã giảm giá.');
    ok(res, { deleted: id });
  }),
);

/* ================================================================== *
 *  0c. THÔNG BÁO NỘI BỘ (Admin soạn -> nhân viên đọc)
 * ================================================================== */

/** Danh sách thông báo (kể cả bản chưa đăng) + số người đã đọc. */
adminRouter.get(
  '/announcements',
  asyncRoute(async (_req, res) => {
    ok(res, await listAnnouncementsAdmin());
  }),
);

adminRouter.post(
  '/announcements',
  asyncRoute(async (req, res) => {
    const input = parseAnnouncementInput(req.body);
    const created = await createAnnouncement(input, {
      id: req.staff!.id,
      full_name: req.staff!.full_name,
    });
    bus.publish({ type: 'announcement.updated' });
    ok(res, created, 201);
  }),
);

adminRouter.patch(
  '/announcements/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    const input = parseAnnouncementInput(req.body);
    const updated = await updateAnnouncement(id, input);
    bus.publish({ type: 'announcement.updated' });
    ok(res, updated);
  }),
);

adminRouter.delete(
  '/announcements/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    const res1 = await deleteAnnouncement(id);
    bus.publish({ type: 'announcement.updated' });
    ok(res, res1);
  }),
);

/* ================================================================== *
 *  1. QUẢN LÝ TÀI KHOẢN
 * ================================================================== */

const userListSchema = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(['admin', 'staff']).optional(),
  is_active: z.enum(['true', 'false']).optional(),
  branch_id: z.string().optional(),
});

adminRouter.get(
  '/users',
  asyncRoute(async (req, res) => {
    const f = userListSchema.parse(req.query);
    const where: string[] = ['1 = 1'];
    const params: SqlParam[] = [];

    if (f.q) {
      params.push(`%${f.q}%`);
      where.push(`(u.username ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`);
    }
    if (f.role) {
      params.push(f.role);
      where.push(`u.role = $${params.length}`);
    }
    if (f.is_active) {
      params.push(f.is_active === 'true');
      where.push(`u.is_active = $${params.length}`);
    }
    if (f.branch_id && f.branch_id !== 'all') {
      if (f.branch_id === 'none') where.push('u.branch_id IS NULL');
      else {
        params.push(toInt(f.branch_id, -1));
        where.push(`u.branch_id = $${params.length}`);
      }
    }

    const rows = await query(
      `SELECT u.id, u.username, u.full_name, u.role, u.phone, u.note, u.is_active,
              u.last_login_at, u.created_at, u.branch_id, b.name AS branch_name,
              (SELECT COUNT(*)::int FROM orders o WHERE o.received_by = u.id) AS received_orders,
              (SELECT COUNT(*)::int FROM orders o WHERE o.paid_by = u.id)      AS paid_orders
         FROM users u
         LEFT JOIN branches b ON b.id = u.branch_id
        WHERE ${where.join(' AND ')}
        ORDER BY u.role, u.username`,
      params,
    );
    ok(res, rows);
  }),
);

const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Tài khoản tối thiểu 3 ký tự.')
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Tài khoản chỉ gồm chữ, số và các ký tự . _ -'),
  password: z.string().min(4, 'Mật khẩu tối thiểu 4 ký tự.').max(100),
  full_name: z.string().trim().min(2, 'Vui lòng nhập họ tên.').max(80),
  role: z.enum(['admin', 'staff']).default('staff'),
  phone: z.string().trim().max(20).optional().nullable(),
  note: z.string().trim().max(200).optional().nullable(),
  branch_id: z.number().int().positive().nullable().optional(),
  is_active: z.boolean().default(true),
});

adminRouter.post(
  '/users',
  asyncRoute(async (req, res) => {
    const body = createUserSchema.parse(req.body);

    const exists = await queryOne('SELECT 1 FROM users WHERE username = $1', [body.username.toLowerCase()]);
    if (exists) throw conflict('Tài khoản này đã tồn tại.');

    // Admin mặc định xem tất cả cơ sở; nhân viên phải thuộc 1 cơ sở
    let branchId: number | null = null;
    if (body.role === 'staff') {
      branchId = await requireBranch(body.branch_id);
      if (!branchId) throw badRequest('Vui lòng chọn cơ sở cho nhân viên.');
    }

    const hash = await hashPassword(body.password);
    const rows = await query(
      `INSERT INTO users (username, password_hash, full_name, role, phone, note, branch_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, username, full_name, role, phone, note, branch_id, is_active, created_at`,
      [
        body.username.toLowerCase(),
        hash,
        body.full_name,
        body.role,
        body.phone || null,
        body.note || null,
        branchId,
        body.is_active,
      ],
    );
    ok(res, rows[0], 201);
  }),
);

const updateUserSchema = z.object({
  full_name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(['admin', 'staff']).optional(),
  phone: z.string().trim().max(20).optional().nullable(),
  note: z.string().trim().max(200).optional().nullable(),
  branch_id: z.number().int().positive().nullable().optional(),
  is_active: z.boolean().optional(),
  password: z.string().min(4).max(100).optional(),
});

adminRouter.patch(
  '/users/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    const body = updateUserSchema.parse(req.body);

    const user = await queryOne<{ id: number; role: string; username: string }>(
      'SELECT id, role, username FROM users WHERE id = $1',
      [id],
    );
    if (!user) throw notFound('Không tìm thấy tài khoản.');

    // Không cho phép tự khóa / tự hạ quyền tài khoản admin cuối cùng
    if (user.role === 'admin' && (body.role === 'staff' || body.is_active === false)) {
      const others = await queryOne<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active AND id <> $1`,
        [id],
      );
      if ((others?.count ?? 0) === 0) {
        throw badRequest('Phải còn ít nhất 1 tài khoản Admin đang hoạt động.');
      }
    }

    const sets: string[] = [];
    const params: SqlParam[] = [id];

    if (body.full_name !== undefined) {
      params.push(body.full_name);
      sets.push(`full_name = $${params.length}`);
    }
    if (body.role !== undefined) {
      params.push(body.role);
      sets.push(`role = $${params.length}`);
    }
    if (body.phone !== undefined) {
      params.push(body.phone || null);
      sets.push(`phone = $${params.length}`);
    }
    if (body.note !== undefined) {
      params.push(body.note || null);
      sets.push(`note = $${params.length}`);
    }
    if (body.branch_id !== undefined) {
      params.push(await requireBranch(body.branch_id));
      sets.push(`branch_id = $${params.length}`);
    }
    if (body.is_active !== undefined) {
      params.push(body.is_active);
      sets.push(`is_active = $${params.length}`);
    }
    if (body.password !== undefined) {
      params.push(await hashPassword(body.password));
      sets.push(`password_hash = $${params.length}`);
    }

    if (sets.length === 0) throw badRequest('Không có thông tin nào để cập nhật.');

    const rows = await query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $1
       RETURNING id, username, full_name, role, phone, note, branch_id, is_active, created_at`,
      params,
    );
    ok(res, rows[0]);
  }),
);

adminRouter.delete(
  '/users/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    const self = req.staff!.id;
    if (id === self) throw badRequest('Không thể tự xoá tài khoản của mình.');

    const user = await queryOne<{ id: number; role: string }>('SELECT id, role FROM users WHERE id = $1', [id]);
    if (!user) throw notFound('Không tìm thấy tài khoản.');

    if (user.role === 'admin') {
      const others = await queryOne<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active AND id <> $1`,
        [id],
      );
      if ((others?.count ?? 0) === 0) throw badRequest('Phải còn ít nhất 1 tài khoản Admin.');
    }

    await query('DELETE FROM users WHERE id = $1', [id]);
    ok(res, { deleted: id });
  }),
);

adminRouter.post(
  '/users/:id/reset-password',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    const { password } = z.object({ password: z.string().min(4).max(100) }).parse(req.body);
    const user = await queryOne('SELECT id FROM users WHERE id = $1', [id]);
    if (!user) throw notFound('Không tìm thấy tài khoản.');

    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, await hashPassword(password)]);
    ok(res, { reset: true });
  }),
);

/* ================================================================== *
 *  2. QUẢN LÝ MÓN ĂN + PHẦN CHỌN ĐI KÈM
 * ================================================================== */

const optionItemSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, 'Tên lựa chọn không được để trống.').max(80),
  price_delta: z.number().min(-1000000).max(1000000).default(0),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().min(0).max(9999).default(0),
});

const optionGroupSchema = z.object({
  name: z.string().trim().min(1, 'Tên nhóm không được để trống.').max(80),
  description: z.string().trim().max(200).optional().nullable(),
  is_required: z.boolean().default(false),
  is_multiple: z.boolean().default(false),
  min_select: z.number().int().min(0).max(50).default(0),
  max_select: z.number().int().min(1).max(50).default(1),
  sort_order: z.number().int().min(0).max(9999).default(0),
  is_active: z.boolean().default(true),
  items: z.array(optionItemSchema).max(60).default([]),
});

const dishSchema = z.object({
  name: z.string().trim().min(1, 'Tên món không được để trống.').max(120),
  description: z.string().trim().max(500).optional().nullable(),
  category: z.string().trim().max(60).optional().nullable(),
  image_url: z.string().trim().max(500).optional().nullable(),
  price: z.number().min(0).max(100000000).default(0),
  is_available: z.boolean().default(true),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().min(0).max(9999).default(0),
  option_group_ids: z.array(z.number().int().positive()).max(20).default([]),
});

// --- Nhóm lựa chọn ---
adminRouter.get(
  '/option-groups',
  asyncRoute(async (_req, res) => {
    const groups = await query<OptionGroup & { id: number }>(
      `SELECT * FROM option_groups ORDER BY sort_order, id`,
    );
    const items = await query<OptionItem & { group_id: number }>(
      'SELECT * FROM option_items ORDER BY sort_order, id',
    );
    const usage = await query<{ group_id: number; dish_count: number }>(
      `SELECT group_id, COUNT(*)::int AS dish_count FROM dish_option_groups GROUP BY group_id`,
    );
    const usageMap = new Map<number, number>(usage.map((u) => [Number(u.group_id), Number(u.dish_count)]));

    ok(
      res,
      groups.map((g) => ({
        ...g,
        dish_count: usageMap.get(g.id) ?? 0,
        items: items.filter((i) => i.group_id === g.id),
      })),
    );
  }),
);

adminRouter.post(
  '/option-groups',
  asyncRoute(async (req, res) => {
    const body = optionGroupSchema.parse(req.body);
    if (!body.is_multiple && body.max_select > 1) body.max_select = 1;
    if (body.max_select < body.min_select) throw badRequest('Số lượng tối đa phải >= số lượng tối thiểu.');

    const group = await withTransaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO option_groups
           (name, description, is_required, is_multiple, min_select, max_select, sort_order, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          body.name,
          body.description || null,
          body.is_required,
          body.is_multiple,
          body.min_select,
          body.max_select,
          body.sort_order,
          body.is_active,
        ],
      );
      for (const [idx, it] of body.items.entries()) {
        await client.query(
          `INSERT INTO option_items (group_id, name, price_delta, is_default, is_active, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [ins.rows[0].id, it.name, it.price_delta, it.is_default, it.is_active, it.sort_order || idx],
        );
      }
      return ins.rows[0];
    });

    bus.publish({ type: 'menu.updated' });
    ok(res, group, 201);
  }),
);

adminRouter.patch(
  '/option-groups/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    const body = optionGroupSchema.parse(req.body);
    const maxSelect = body.is_multiple ? body.max_select : 1;
    if (maxSelect < body.min_select) throw badRequest('Số lượng tối đa phải >= số lượng tối thiểu.');

    const updated = await withTransaction(async (client) => {
      const exists = await client.query('SELECT id FROM option_groups WHERE id = $1', [id]);
      if (exists.rowCount === 0) throw notFound('Không tìm thấy nhóm lựa chọn.');

      await client.query(
        `UPDATE option_groups
            SET name=$2, description=$3, is_required=$4, is_multiple=$5,
                min_select=$6, max_select=$7, sort_order=$8, is_active=$9
          WHERE id=$1`,
        [
          id,
          body.name,
          body.description || null,
          body.is_required,
          body.is_multiple,
          body.min_select,
          maxSelect,
          body.sort_order,
          body.is_active,
        ],
      );

      const keepIds: number[] = [];
      for (const [idx, it] of body.items.entries()) {
        if (it.id) {
          const upd = await client.query(
            `UPDATE option_items SET name=$3, price_delta=$4, is_default=$5, is_active=$6, sort_order=$7
              WHERE id=$1 AND group_id=$2 RETURNING id`,
            [it.id, id, it.name, it.price_delta, it.is_default, it.is_active, it.sort_order || idx],
          );
          if ((upd.rowCount ?? 0) > 0) keepIds.push(upd.rows[0].id);
        } else {
          const ins = await client.query(
            `INSERT INTO option_items (group_id, name, price_delta, is_default, is_active, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [id, it.name, it.price_delta, it.is_default, it.is_active, it.sort_order || idx],
          );
          keepIds.push(ins.rows[0].id);
        }
      }

      // các mục không còn trong danh sách -> vô hiệu hoá thay vì xoá (giữ lịch sử order)
      await client.query(
        `UPDATE option_items SET is_active = FALSE
          WHERE group_id = $1 AND NOT (id = ANY($2::int[]))`,
        [id, keepIds.length ? keepIds : [-1]],
      );

      const res2 = await client.query('SELECT * FROM option_groups WHERE id = $1', [id]);
      return res2.rows[0];
    });

    bus.publish({ type: 'menu.updated' });
    ok(res, updated);
  }),
);

adminRouter.delete(
  '/option-groups/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    const used = await queryOne<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM dish_option_groups WHERE group_id = $1',
      [id],
    );
    if ((used?.count ?? 0) > 0) {
      throw conflict('Nhóm lựa chọn đang được gán cho món ăn. Vui lòng gỡ khỏi món trước.');
    }
    await query('DELETE FROM option_groups WHERE id = $1', [id]);
    bus.publish({ type: 'menu.updated' });
    ok(res, { deleted: id });
  }),
);

// --- Món ăn ---
adminRouter.get(
  '/dishes',
  asyncRoute(async (_req, res) => {
    const dishes = await query(
      `SELECT id, name, description, category, image_url, price, is_available, is_active, sort_order, created_at
         FROM dishes ORDER BY sort_order, id`,
    );
    const links = await query<{ dish_id: number; group_id: number }>(
      'SELECT dish_id, group_id FROM dish_option_groups ORDER BY sort_order',
    );
    ok(
      res,
      dishes.map((d) => ({
        ...d,
        option_group_ids: links.filter((l) => l.dish_id === d.id).map((l) => l.group_id),
      })),
    );
  }),
);

adminRouter.post(
  '/dishes',
  asyncRoute(async (req, res) => {
    const body = dishSchema.parse(req.body);

    const dish = await withTransaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO dishes (name, description, category, image_url, price, is_available, is_active, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          body.name,
          body.description || null,
          body.category || null,
          body.image_url || null,
          body.price,
          body.is_available,
          body.is_active,
          body.sort_order,
        ],
      );
      for (const [idx, gid] of body.option_group_ids.entries()) {
        await client.query(
          'INSERT INTO dish_option_groups (dish_id, group_id, sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [ins.rows[0].id, gid, idx],
        );
      }
      const res2 = await client.query('SELECT * FROM dishes WHERE id = $1', [ins.rows[0].id]);
      return res2.rows[0];
    });

    bus.publish({ type: 'menu.updated' });
    ok(res, dish, 201);
  }),
);

adminRouter.patch(
  '/dishes/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    const body = dishSchema.parse(req.body);

    const dish = await withTransaction(async (client) => {
      const exists = await client.query('SELECT id FROM dishes WHERE id = $1', [id]);
      if (exists.rowCount === 0) throw notFound('Không tìm thấy món ăn.');

      await client.query(
        `UPDATE dishes SET name=$2, description=$3, category=$4, image_url=$5, price=$6,
                          is_available=$7, is_active=$8, sort_order=$9
          WHERE id=$1`,
        [
          id,
          body.name,
          body.description || null,
          body.category || null,
          body.image_url || null,
          body.price,
          body.is_available,
          body.is_active,
          body.sort_order,
        ],
      );

      await client.query('DELETE FROM dish_option_groups WHERE dish_id = $1', [id]);
      for (const [idx, gid] of body.option_group_ids.entries()) {
        await client.query(
          'INSERT INTO dish_option_groups (dish_id, group_id, sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [id, gid, idx],
        );
      }
      const res2 = await client.query('SELECT * FROM dishes WHERE id = $1', [id]);
      return res2.rows[0];
    });

    bus.publish({ type: 'menu.updated' });
    ok(res, dish);
  }),
);

adminRouter.delete(
  '/dishes/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    // Giữ lại món đã từng được order: chuyển sang ẩn thay vì xoá hẳn
    const used = await queryOne<{ count: number }>('SELECT COUNT(*)::int AS count FROM order_items WHERE dish_id = $1', [id]);
    if ((used?.count ?? 0) > 0) {
      await query('UPDATE dishes SET is_active = FALSE WHERE id = $1', [id]);
      bus.publish({ type: 'menu.updated' });
      ok(res, { soft_deleted: true, message: 'Món đã có trong lịch sử order nên được ẩn khỏi menu.' });
      return;
    }
    await query('DELETE FROM dishes WHERE id = $1', [id]);
    bus.publish({ type: 'menu.updated' });
    ok(res, { deleted: id });
  }),
);

/** Bật/tắt nhanh "hết món" */
adminRouter.patch(
  '/dishes/:id/availability',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    const { is_available } = z.object({ is_available: z.boolean() }).parse(req.body);
    const rows = await query('UPDATE dishes SET is_available = $2 WHERE id = $1 RETURNING id, is_available', [
      id,
      is_available,
    ]);
    if (rows.length === 0) throw notFound('Không tìm thấy món ăn.');
    bus.publish({ type: 'menu.updated' });
    ok(res, rows[0]);
  }),
);

/* ================================================================== *
 *  3. QUẢN LÝ BÀN + MÃ QR
 * ================================================================== */

const tableSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Mã bàn không được để trống.')
    .max(20)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Mã bàn chỉ gồm chữ, số, - và _'),
  name: z.string().trim().min(1, 'Tên bàn không được để trống.').max(80),
  area: z.string().trim().max(60).optional().nullable(),
  seats: z.number().int().min(1).max(50).default(4),
  branch_id: z.number().int().positive().nullable().optional(),
  is_active: z.boolean().default(true),
  note: z.string().trim().max(200).optional().nullable(),
});

const withQrUrl = (t: RestTable) => ({ ...t, qr_url: `${config.publicUrl}/t/${t.qr_token}` });

const tableListSchema = z.object({ branch_id: z.string().optional() });

adminRouter.get(
  '/tables',
  asyncRoute(async (req, res) => {
    const f = tableListSchema.parse(req.query);
    const params: SqlParam[] = [];
    const clause = branchWhere(req, params);

    const rows = await query<RestTable & { active_order_count: number; branch_name: string | null }>(
      `SELECT t.*, b.name AS branch_name,
              (SELECT COUNT(*)::int FROM orders o
                WHERE o.table_id = t.id AND o.status IN ('pending','confirmed','served')) AS active_order_count
         FROM rest_tables t
         LEFT JOIN branches b ON b.id = t.branch_id
        WHERE 1 = 1${clause}
        ORDER BY t.code`,
      params,
    );
    ok(
      res,
      rows.map((r) => ({ ...withQrUrl(r), qr_token: undefined, active_order_count: r.active_order_count })),
    );
  }),
);

adminRouter.post(
  '/tables',
  asyncRoute(async (req, res) => {
    const body = tableSchema.parse(req.body);
    const exists = await queryOne('SELECT 1 FROM rest_tables WHERE UPPER(code) = UPPER($1)', [body.code]);
    if (exists) throw conflict('Mã bàn đã tồn tại.');
    const branchId = await requireBranch(body.branch_id);
    if (!branchId) throw badRequest('Vui lòng chọn cơ sở cho bàn.');

    const rows = await query(
      `INSERT INTO rest_tables (code, name, area, seats, branch_id, is_active, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [body.code, body.name, body.area || null, body.seats, branchId, body.is_active, body.note || null],
    );
    bus.publish({ type: 'table.updated' });
    ok(res, withQrUrl(rows[0] as unknown as RestTable), 201);
  }),
);

adminRouter.patch(
  '/tables/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    const body = tableSchema.parse(req.body);

    const dup = await queryOne('SELECT 1 FROM rest_tables WHERE UPPER(code) = UPPER($1) AND id <> $2', [body.code, id]);
    if (dup) throw conflict('Mã bàn đã tồn tại.');

    const branchId = await requireBranch(body.branch_id);
    if (!branchId) throw badRequest('Vui lòng chọn cơ sở cho bàn.');

    const rows = await query(
      `UPDATE rest_tables SET code=$2, name=$3, area=$4, seats=$5, branch_id=$6, is_active=$7, note=$8
        WHERE id=$1 RETURNING *`,
      [id, body.code, body.name, body.area || null, body.seats, branchId, body.is_active, body.note || null],
    );
    if (rows.length === 0) throw notFound('Không tìm thấy bàn.');
    bus.publish({ type: 'table.updated' });
    ok(res, withQrUrl(rows[0] as unknown as RestTable));
  }),
);

adminRouter.delete(
  '/tables/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    const active = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM orders WHERE table_id = $1 AND status IN ('pending','confirmed','served')`,
      [id],
    );
    if ((active?.count ?? 0) > 0) throw conflict('Bàn đang có đơn chưa thanh toán, không thể xoá.');

    const used = await queryOne<{ count: number }>('SELECT COUNT(*)::int AS count FROM orders WHERE table_id = $1', [id]);
    if ((used?.count ?? 0) > 0) {
      await query('UPDATE rest_tables SET is_active = FALSE WHERE id = $1', [id]);
      bus.publish({ type: 'table.updated' });
      ok(res, { soft_deleted: true, message: 'Bàn đã có lịch sử order nên được vô hiệu hoá thay vì xoá.' });
      return;
    }

    await query('DELETE FROM rest_tables WHERE id = $1', [id]);
    bus.publish({ type: 'table.updated' });
    ok(res, { deleted: id });
  }),
);

/** Tạo lại QR token (dùng khi in lại thẻ bàn) */
adminRouter.post(
  '/tables/:id/regenerate-qr',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    const rows = await query(
      "UPDATE rest_tables SET qr_token = gen_random_uuid()::text WHERE id = $1 RETURNING *",
      [id],
    );
    if (rows.length === 0) throw notFound('Không tìm thấy bàn.');
    bus.publish({ type: 'table.updated' });
    ok(res, withQrUrl(rows[0] as unknown as RestTable));
  }),
);

/** Danh sách file QR (data url) để in thẻ bàn — có bộ lọc cơ sở */
adminRouter.get(
  '/tables/qr-sheet',
  asyncRoute(async (req, res) => {
    const onlyActive = req.query.all !== 'true';
    const params: SqlParam[] = [];
    const clause = branchWhere(req, params);
    const rows = await query<RestTable>(
      `SELECT t.*, b.name AS branch_name
         FROM rest_tables t
         LEFT JOIN branches b ON b.id = t.branch_id
        WHERE ${onlyActive ? 't.is_active' : '1 = 1'}${clause}
        ORDER BY t.code`,
      params,
    );

    const items = await Promise.all(
      rows.map(async (t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        area: t.area,
        seats: t.seats,
        is_active: t.is_active,
        branch_name: t.branch_name,
        url: `${config.publicUrl}/t/${t.qr_token}`,
        qr: await QRCode.toDataURL(`${config.publicUrl}/t/${t.qr_token}`, {
          width: 512,
          margin: 2,
          errorCorrectionLevel: 'M',
        }),
      })),
    );
    ok(res, items);
  }),
);

/* ================================================================== *
 *  4. LỊCH SỬ ORDER (chỉ Admin)
 * ================================================================== */

const historySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((s) => (s ? (s.split(',').map((v) => v.trim()).filter(Boolean) as OrderStatus[]) : undefined)),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  tableId: z.coerce.number().int().positive().optional(),
  staffId: z.coerce.number().int().positive().optional(),
  branch_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

adminRouter.get(
  '/order-history',
  asyncRoute(async (req, res) => {
    const f = historySchema.parse(req.query);

    let where = "o.status <> 'draft'";
    const params: SqlParam[] = [];

    if (f.status?.length) {
      params.push(f.status);
      where += ` AND o.status = ANY($${params.length}::order_status[])`;
    }
    if (f.from) {
      params.push(f.from);
      where += ` AND o.created_at >= $${params.length}`;
    }
    if (f.to) {
      params.push(f.to);
      where += ` AND o.created_at <= $${params.length}`;
    }
    if (f.tableId) {
      params.push(f.tableId);
      where += ` AND o.table_id = $${params.length}`;
    }
    if (f.staffId) {
      params.push(f.staffId);
      where += ` AND (o.received_by = $${params.length} OR o.paid_by = $${params.length})`;
    }
    if (f.q) {
      params.push(`%${f.q}%`);
      const i = params.length;
      where += ` AND (o.order_no ILIKE $${i} OR o.customer_name ILIKE $${i} OR o.customer_phone ILIKE $${i}
                          OR t.code ILIKE $${i} OR o.received_by_name ILIKE $${i} OR o.paid_by_name ILIKE $${i}
                          OR o.discount_code ILIKE $${i})`;
    }
    where += branchWhere(req, params);

    const totalRow = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM orders o LEFT JOIN rest_tables t ON t.id = o.table_id WHERE ${where}`,
      params,
    );

    const rows = await query(
      `SELECT o.*, t.code AS table_code, t.name AS table_name, t.area AS table_area,
              b.name AS table_branch_name,
              (SELECT COALESCE(SUM(quantity),0) FROM order_items oi WHERE oi.order_id = o.id)::int AS item_count
         FROM orders o
         LEFT JOIN rest_tables t ON t.id = o.table_id
         LEFT JOIN branches    b ON b.id = t.branch_id
        WHERE ${where}
        ORDER BY o.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, f.limit, f.offset],
    );

    ok(res, { rows, total: totalRow?.count ?? 0, limit: f.limit, offset: f.offset });
  }),
);

/**
 * Báo cáo doanh thu — dữ liệu cho biểu đồ + bảng.
 *
 * Gộp chung một CTE `paid` nên mọi truy vấn dùng cùng bộ lọc (khoảng ngày + cơ sở)
 * và chỉ quét bảng orders một lần cho phần "đã thanh toán".
 */
adminRouter.get(
  '/reports',
  asyncRoute(async (req, res) => {
    const { from, to } = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(req.query);

    const params: SqlParam[] = [];
    const where: string[] = ["o.status = 'paid'"];
    if (from) {
      params.push(from);
      where.push(`o.paid_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`o.paid_at <= $${params.length}`);
    }
    // Bộ lọc cơ sở (bảng của đơn). Admin xem tất cả nếu không chọn.
    // `timeParamCount` lưu số tham số CHỈ của khoảng ngày, để các truy vấn
    // không lọc cơ sở (byBranch) dùng đúng số tham số — thừa tham số sẽ làm
    // PostgreSQL báo "supplies N parameters, but prepared statement requires M".
    const timeParamCount = params.length;
    const branchClause = branchWhere(req, params);
    const clause = `WHERE ${where.join(' AND ')}${branchClause}`;

    const daily = await query(
      `SELECT to_char(date_trunc('day', o.paid_at), 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS orders,
              COALESCE(SUM(o.total),0) AS revenue,
              COALESCE(SUM(o.discount),0) AS discount
         FROM orders o
         LEFT JOIN rest_tables t ON t.id = o.table_id
         ${clause}
        GROUP BY 1 ORDER BY 1 ASC LIMIT 400`,
      params,
    );

    /** Số đơn theo khung giờ (0-23) — dùng cho biểu đồ "giờ vàng". */
    const byHour = await query(
      `SELECT EXTRACT(HOUR FROM o.paid_at)::int AS hour,
              COUNT(*)::int AS orders,
              COALESCE(SUM(o.total),0) AS revenue
         FROM orders o
         LEFT JOIN rest_tables t ON t.id = o.table_id
         ${clause}
        GROUP BY 1 ORDER BY 1 ASC`,
      params,
    );

    const byStaff = await query(
      `SELECT u.id, u.full_name,
              COUNT(*)::int AS paid_orders,
              COALESCE(SUM(o.total),0) AS revenue
         FROM orders o
         JOIN users u ON u.id = o.paid_by
         LEFT JOIN rest_tables t ON t.id = o.table_id
         ${clause}
        GROUP BY u.id, u.full_name
        ORDER BY revenue DESC`,
      params,
    );

    const byTable = await query(
      `SELECT t.id, t.code, t.name,
              COUNT(*)::int AS paid_orders,
              COALESCE(SUM(o.total),0) AS revenue
         FROM orders o
         JOIN rest_tables t ON t.id = o.table_id
         ${clause}
        GROUP BY t.id, t.code, t.name
        ORDER BY revenue DESC LIMIT 50`,
      params,
    );

    /** So sánh giữa các cơ sở (luôn trả về tất cả cơ sở, kể cả khi đang lọc 1 cơ sở). */
    const byBranch = await query(
      `SELECT b.id, b.name,
              COUNT(*)::int AS paid_orders,
              COALESCE(SUM(o.total),0) AS revenue
         FROM orders o
         JOIN rest_tables t ON t.id = o.table_id
         JOIN branches b ON b.id = t.branch_id
        WHERE ${where.join(' AND ')}
        GROUP BY b.id, b.name
        ORDER BY revenue DESC`,
      params.slice(0, timeParamCount),
    );

    /** Món bán chạy trong khoảng thời gian (biểu đồ cột ngang). */
    const topDishes = await query(
      `SELECT oi.dish_name AS name,
              SUM(oi.quantity)::int AS quantity,
              COALESCE(SUM(oi.line_total),0) AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN rest_tables t ON t.id = o.table_id
         ${clause}
        GROUP BY oi.dish_name
        ORDER BY quantity DESC
        LIMIT 12`,
      params,
    );

    const totals = await queryOne<{ orders: number; revenue: number; discount: number; items: number; avg_order: number }>(
      `SELECT COUNT(*)::int AS orders,
              COALESCE(SUM(o.total),0) AS revenue,
              COALESCE(SUM(o.discount),0) AS discount,
              COALESCE(SUM((SELECT COALESCE(SUM(quantity),0) FROM order_items oi WHERE oi.order_id = o.id)), 0) AS items
         FROM orders o
         LEFT JOIN rest_tables t ON t.id = o.table_id
         ${clause}`,
      params,
    );

    const byDiscount = await query(
      `SELECT o.discount_code AS code, COUNT(*)::int AS orders,
              COALESCE(SUM(o.discount_amount),0) AS discount
         FROM orders o
         LEFT JOIN rest_tables t ON t.id = o.table_id
         ${clause} AND o.discount_code IS NOT NULL
        GROUP BY o.discount_code
        ORDER BY discount DESC
        LIMIT 20`,
      params,
    );

    /** So sánh số đơn đã thanh toán với tổng số đơn trong khoảng.
     *
     * Đơn đã thanh toán thì lọc theo paid_at; đơn chưa thanh toán có paid_at
     * còn NULL nên phải lọc theo created_at — nếu dùng chung một điều kiện
     * paid_at thì mọi đơn đang mở đều rơi ra ngoài và biểu đồ luôn ra 0.
     */
    const fParams: SqlParam[] = [];
    const fFrom = from ? fParams.push(from) : 0;
    const fTo = to ? fParams.push(to) : 0;
    const paidWhen = [from ? `o.paid_at >= $${fFrom}` : '', to ? `o.paid_at <= $${fTo}` : '']
      .filter(Boolean)
      .join(' AND ');
    const openWhen = [from ? `o.created_at >= $${fFrom}` : '', to ? `o.created_at <= $${fTo}` : '']
      .filter(Boolean)
      .join(' AND ');
    const fBranch = branchWhere(req, fParams);

    const funnel = await queryOne<{ paid: number; cancelled: number; open: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE o.status = 'paid')::int     AS paid,
         COUNT(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled,
         COUNT(*) FILTER (WHERE o.status IN ('pending','confirmed','served'))::int AS open
       FROM orders o
       LEFT JOIN rest_tables t ON t.id = o.table_id
       WHERE o.status <> 'draft'
         AND ( (${paidWhen || 'TRUE'}) OR (o.paid_at IS NULL AND ${openWhen || 'TRUE'}) )${fBranch}`,
      fParams,
    );

    const orderCount = Number(totals?.orders ?? 0);
    const revenue = Number(totals?.revenue ?? 0);

    ok(res, {
      daily,
      byHour,
      byStaff,
      byTable,
      byBranch,
      byDiscount,
      topDishes,
      totals: {
        orders: orderCount,
        revenue,
        discount: Number(totals?.discount ?? 0),
        items: Number(totals?.items ?? 0),
        avg_order: orderCount ? Math.round(revenue / orderCount) : 0,
      },
      funnel: {
        paid: funnel?.paid ?? 0,
        cancelled: funnel?.cancelled ?? 0,
        open: funnel?.open ?? 0,
      },
    });
  }),
);

/** Thống kê tổng quan (hỗ trợ lọc cơ sở) */
adminRouter.get(
  '/stats',
  asyncRoute(async (req, res) => {
    const f = effectiveBranchFilter(req, req.query.branch_id);
    ok(res, await dashboardStats({ branchId: f === 'none' ? -1 : f }));
  }),
);

/** Bảng lịch sử gọn cho màn in bill nhanh */
adminRouter.get(
  '/orders',
  asyncRoute(async (req, res) => {
    const f = listHistoryLite(req.query);
    const { rows, total } = await listOrders(f);
    ok(res, { rows, total });
  }),
);

function listHistoryLite(q: unknown) {
  const parsed = z
    .object({
      status: z.string().optional(),
      q: z.string().trim().max(100).optional(),
      branch_id: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    })
    .parse(q);

  const raw = parsed.status ? parsed.status.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const statuses = (raw.length ? raw : ['pending', 'confirmed', 'served', 'paid', 'cancelled']) as OrderStatus[];
  const f = effectiveBranchFilter({ staff: { role: 'admin', branch_id: null } }, parsed.branch_id);

  return {
    statuses,
    q: parsed.q,
    branchId: f === 'none' ? -1 : f,
    limit: parsed.limit ?? 50,
    offset: parsed.offset ?? 0,
  };
}
