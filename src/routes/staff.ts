import { Router, type Request } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { query, queryOne } from '../db.js';
import { config } from '../config.js';
import { asyncRoute, ok } from '../middleware/errors.js';
import { requireStaff } from '../middleware/auth.js';
import { badRequest, forbidden, notFound, toInt } from '../utils.js';
import {
  confirmOrder,
  dashboardStats,
  deleteDraftOrder,
  getOrderByNo,
  listOrders,
  markPaid,
  markServed,
  rejectOrder,
  unservedOrder,
} from '../services/order.service.js';
import {
  checkDiscountCode,
  effectiveBranchFilter,
  listBranches,
  NO_BRANCH,
  normalizeDiscountCode,
  scopeBranchId,
} from '../services/branch.js';
import {
  listAnnouncementsForUser,
  markAllAnnouncementsRead,
  markAnnouncementRead,
} from '../services/announcement.service.js';
import type { Branch, Order, OrderStatus, RestTable } from '../types.js';

export const staffRouter = Router();

// Admin cũng dùng được toàn bộ API này (Admin có quyền như nhân viên).
staffRouter.use(requireStaff);

/* ------------------------------------------------------------------ *
 *  Phạm vi cơ sở
 *
 *  - Nhân viên: chỉ thấy & thao tác được trên đơn/bàn của cơ sở mình.
 *  - Admin     : thấy tất cả, có thể thêm `?branch_id=` để lọc cho nhanh.
 * ------------------------------------------------------------------ */

/** branch_id dùng để lọc: null = tất cả, -1 = không có đơn nào khớp. */
function branchFilter(req: Request): number | null {
  const f = effectiveBranchFilter(req, req.query.branch_id);
  return f === 'none' ? -1 : f;
}

/** Chặn nhân viên thao tác lên đơn thuộc cơ sở khác. */
function assertOrderAccess(req: Request, order: Order): void {
  if (req.staff?.role === 'admin') return;
  const scope = scopeBranchId(req);
  if (scope == null) return; // Admin
  const tableBranch = (order as Order & { table_branch_id?: number | null }).table_branch_id ?? null;
  if (tableBranch !== scope) {
    throw forbidden('Đơn này thuộc cơ sở khác. Bạn không có quyền xử lý.');
  }
}

const loadOrderByNo = async (req: Request, orderNo: string): Promise<Order> => {
  const order = await getOrderByNo(orderNo, true);
  if (!order) throw notFound('Không tìm thấy đơn.');
  assertOrderAccess(req, order);
  return order;
};

const staffOf = (req: Request) => ({
  id: req.staff!.id,
  full_name: req.staff!.full_name,
});

/* ------------------------------------------------------------------ *
 *  Danh sách order
 * ------------------------------------------------------------------ */

const listSchema = z.object({
  status: z
    .string()
    .optional()
    .transform((s) =>
      s ? (s.split(',').map((v) => v.trim()).filter(Boolean) as OrderStatus[]) : undefined,
    ),
  tableId: z.coerce.number().int().positive().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  branch_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const VALID_STATUS: OrderStatus[] = ['draft', 'pending', 'confirmed', 'served', 'paid', 'cancelled'];

staffRouter.get(
  '/orders',
  asyncRoute(async (req, res) => {
    const f = listSchema.parse(req.query);
    if (f.status?.some((s) => !VALID_STATUS.includes(s))) throw badRequest('Trạng thái không hợp lệ.');

    const { rows, total } = await listOrders({
      statuses: f.status,
      tableId: f.tableId,
      from: f.from,
      to: f.to,
      q: f.q,
      branchId: branchFilter(req),
      limit: f.limit ?? 100,
      offset: f.offset ?? 0,
    });
    ok(res, { rows, total });
  }),
);

/** Danh sách đơn đang chờ nhân viên xác nhận (màn Order) */
staffRouter.get(
  '/orders/pending',
  asyncRoute(async (req, res) => {
    const { rows } = await listOrders({ statuses: ['pending'], branchId: branchFilter(req), limit: 200 });
    ok(res, rows);
  }),
);

/** Danh sách hóa đơn chưa thanh toán (màn Thanh toán) */
staffRouter.get(
  '/orders/unpaid',
  asyncRoute(async (req, res) => {
    const { rows } = await listOrders({ statuses: ['confirmed', 'served'], branchId: branchFilter(req), limit: 200 });
    ok(res, rows);
  }),
);

/**
 * Đơn chưa gửi món (draft) — khách đã quét QR + nhập tên/điện thoại nhưng chưa
 * bấm "Gửi đơn". Màn "Danh sách Order" có tab riêng để nhân viên thấy & xoá,
 * tránh đơn nháp dồn lại vô ích mỗi ngày.
 */
staffRouter.get(
  '/orders/drafts',
  asyncRoute(async (req, res) => {
    const { rows, total } = await listOrders({ statuses: ['draft'], branchId: branchFilter(req), limit: 200 });
    ok(res, { rows, total });
  }),
);

/** Nhân viên xoá đơn chưa gửi (draft) của khách. */
staffRouter.delete(
  '/orders/:orderNo/draft',
  asyncRoute(async (req, res) => {
    const order = await loadOrderByNo(req, req.params.orderNo);
    ok(res, await deleteDraftOrder(order));
  }),
);

staffRouter.get(
  '/orders/:orderNo',
  asyncRoute(async (req, res) => {
    const order = await loadOrderByNo(req, req.params.orderNo);
    ok(res, order);
  }),
);

/** Nhân viên xác nhận nhận order */
staffRouter.post(
  '/orders/:orderNo/confirm',
  asyncRoute(async (req, res) => {
    const order = await loadOrderByNo(req, req.params.orderNo);
    ok(res, await confirmOrder(order, staffOf(req)));
  }),
);

/** Đánh dấu đã phục vụ / mở lại */
staffRouter.post(
  '/orders/:orderNo/serve',
  asyncRoute(async (req, res) => {
    const order = await loadOrderByNo(req, req.params.orderNo);
    const body = z.object({ served: z.boolean().default(true) }).parse(req.body ?? {});
    ok(res, body.served ? await markServed(order, staffOf(req)) : await unservedOrder(order, staffOf(req)));
  }),
);

/** Từ chối / huỷ đơn */
staffRouter.post(
  '/orders/:orderNo/reject',
  asyncRoute(async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().max(300).default('') }).parse(req.body ?? {});
    const order = await loadOrderByNo(req, req.params.orderNo);
    ok(res, await rejectOrder(order, staffOf(req), reason));
  }),
);

/**
 * Kiểm tra mã giảm giá trước khi thanh toán (xem trước số tiền được giảm).
 * Admin tạo mã ở trang "Mã giảm giá"; nhân viên nhập mã ở màn thanh toán.
 */
staffRouter.post(
  '/discount-codes/preview',
  asyncRoute(async (req, res) => {
    const { orderNo, code } = z
      .object({ orderNo: z.string().trim().min(1), code: z.string().trim().min(1).max(40) })
      .parse(req.body ?? {});

    const order = await loadOrderByNo(req, orderNo);
    const result = await checkDiscountCode(code, Number(order.subtotal));
    ok(res, {
      code: result.code.code,
      description: result.code.description,
      percent: result.code.percent,
      subtotal: Number(order.subtotal),
      discount_amount: result.amount,
      total: result.total,
    });
  }),
);

/**
 * Xác nhận đã thanh toán.
 * Hiện chỉ mở hình thức TIỀN MẶT - nhân viên bấm sau khi khách đã đưa tiền.
 * Hình thức chuyển khoản đang để mờ (có thể bật lại bằng cách cho phép method='transfer').
 */
staffRouter.post(
  '/orders/:orderNo/pay',
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        method: z.enum(['cash', 'transfer']).default('cash'),
        discount: z.coerce.number().min(0).optional(),
        discount_code: z.string().trim().max(40).optional().nullable(),
        note: z.string().trim().max(300).optional().nullable(),
      })
      .parse(req.body ?? {});

    if (body.method === 'transfer') {
      throw forbidden('Tính năng thanh toán chuyển khoản đang tạm thời để mờ. Vui lòng dùng thanh toán tiền mặt.');
    }

    const order = await loadOrderByNo(req, req.params.orderNo);
    ok(res, await markPaid(order, staffOf(req), { ...body, discountCode: body.discount_code ?? null }));
  }),
);

/* ------------------------------------------------------------------ *
 *  Bàn & bảng điều khiển (dùng chung với Admin)
 * ------------------------------------------------------------------ */

staffRouter.get(
  '/tables',
  asyncRoute(async (req, res) => {
    const filter = branchFilter(req);
    const params: (number | string)[] = [];
    let where = 'WHERE t.is_active';
    if (filter != null) {
      params.push(filter);
      where += ` AND t.branch_id = $${params.length}`;
    }

    const rows = await query<RestTable & { active_order_count: number }>(
      `SELECT t.*, b.name AS branch_name,
              (SELECT COUNT(*)::int FROM orders o
                WHERE o.table_id = t.id
                  AND o.status IN ('pending','confirmed','served')) AS active_order_count
         FROM rest_tables t
         LEFT JOIN branches b ON b.id = t.branch_id
         ${where}
        ORDER BY t.code`,
      params,
    );
    ok(res, rows);
  }),
);

/** Danh sách cơ sở (để bộ lọc trên UI). Nhân viên chỉ thấy cơ sở của mình. */
staffRouter.get(
  '/branches',
  asyncRoute(async (req, res) => {
    const all = await listBranches(true);
    const rows: Branch[] =
      req.staff?.role === 'admin' ? all : all.filter((b) => b.id === req.staff!.branch_id);
    ok(res, rows);
  }),
);

/** Thống kê nhanh cho màn nhính */
staffRouter.get(
  '/stats',
  asyncRoute(async (req, res) => {
    ok(res, await dashboardStats({ branchId: branchFilter(req) }));
  }),
);

/** Danh sách nhân viên (để in bill hiển thị đúng người phục vụ) */
staffRouter.get(
  '/staff-list',
  asyncRoute(async (req, res) => {
    const scope = scopeBranchId(req) ?? NO_BRANCH;
    const params: number[] = [];
    let where = 'WHERE u.is_active';
    if (req.staff?.role !== 'admin') {
      params.push(scope);
      where += ` AND u.branch_id = $${params.length}`;
    }
    const rows = await query<{ id: number; full_name: string; role: string; branch_name: string | null }>(
      `SELECT u.id, u.full_name, u.role, b.name AS branch_name
         FROM users u
         LEFT JOIN branches b ON b.id = u.branch_id
         ${where}
        ORDER BY u.role, u.full_name`,
      params,
    );
    ok(res, rows);
  }),
);

/** Gán nhân viên phục vụ cho đơn (khi khách gọi món tại bàn) */
staffRouter.post(
  '/orders/:orderNo/assign',
  asyncRoute(async (req, res) => {
    const { staffId } = z.object({ staffId: z.number().int().positive() }).parse(req.body);
    const order = await loadOrderByNo(req, req.params.orderNo);

    const u = await queryOne<{ id: number; full_name: string; is_active: boolean; branch_id: number | null }>(
      'SELECT id, full_name, is_active, branch_id FROM users WHERE id = $1',
      [staffId],
    );
    if (!u || !u.is_active) throw notFound('Không tìm thấy nhân viên.');
    if (req.staff?.role !== 'admin' && u.branch_id !== scopeBranchId(req)) {
      throw forbidden('Chỉ gán được nhân viên cùng cơ sở.');
    }

    await query(
      `UPDATE orders SET received_by = $2, received_by_name = $3 WHERE id = $1`,
      [order.id, u.id, u.full_name],
    );
    ok(res, await getOrderByNo(order.order_no, true));
  }),
);

/* ------------------------------------------------------------------ *
 *  THÔNG BÁO NỘI BỘ
 *
 *  Nhân viên đọc thông báo Admin gửi. Trạng thái "đã đọc" lưu theo từng tài khoản
 *  nên nhân viên nhận ca mới vẫn thấy các thông báo cũ chưa đọc của mình.
 * ------------------------------------------------------------------ */

/** Danh sách thông báo + số đếm chưa đọc (dùng cho trang thông báo & badge sidebar). */
staffRouter.get(
  '/announcements',
  asyncRoute(async (req, res) => {
    ok(res, await listAnnouncementsForUser(req.staff!.id));
  }),
);

/** Số thông báo chưa đọc — gọi nhẹ cho badge (không tải cả nội dung). */
staffRouter.get(
  '/announcements/unread-count',
  asyncRoute(async (req, res) => {
    const { unread_count } = await listAnnouncementsForUser(req.staff!.id);
    ok(res, { unread_count });
  }),
);

/** Đánh dấu 1 thông báo đã đọc. */
staffRouter.post(
  '/announcements/:id/read',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    ok(res, await markAnnouncementRead(id, req.staff!.id));
  }),
);

/** Đánh dấu đã đọc tất cả. */
staffRouter.post(
  '/announcements/read-all',
  asyncRoute(async (req, res) => {
    ok(res, await markAllAnnouncementsRead(req.staff!.id));
  }),
);

/** Danh sách bàn kèm mã QR (mã QR dạng data url) */
staffRouter.get(
  '/tables/:id/qr',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id, 0);
    const table = await queryOne<RestTable>(
      `SELECT t.*, b.name AS branch_name
         FROM rest_tables t
         LEFT JOIN branches b ON b.id = t.branch_id
        WHERE t.id = $1`,
      [id],
    );
    if (!table) throw notFound('Không tìm thấy bàn.');
    const scope = scopeBranchId(req);
    if (req.staff?.role !== 'admin' && (scope == null || table.branch_id !== scope)) {
      throw forbidden('Bàn này thuộc cơ sở khác. Bạn không có quyền xem.');
    }
    const dataUrl = await QRCode.toDataURL(`${config.publicUrl}/t/${table.qr_token}`, {
      width: 480,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    ok(res, { table_id: table.id, code: table.code, name: table.name, url: `${config.publicUrl}/t/${table.qr_token}`, qr: dataUrl });
  }),
);
