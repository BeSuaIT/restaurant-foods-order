import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { badRequest, isValidVietnamPhone, normalizePhone, notFound, randomToken } from '../utils.js';
import { attachTableToken, requireTableSession } from '../middleware/auth.js';
import { asyncRoute, ok } from '../middleware/errors.js';
import {
  addItem,
  clearItems,
  deleteDraftOrder,
  getOrderByNo,
  getOrCreateDraft,
  getSessionByToken,
  submitOrder,
  updateItemQuantity,
  updateOrderNote,
} from '../services/order.service.js';
import type { Dish, DishOptionGroupRef, OptionItem } from '../types.js';

export const publicRouter = Router();

/* ================================================================== *
 *  PHẦN 1 - API công khai (không cần đăng nhập)
 * ================================================================== */

/** Tra cứu bàn theo mã hoặc QR token. */
publicRouter.get(
  '/tables/lookup',
  asyncRoute(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) throw badRequest('Thiếu mã bàn hoặc mã QR.');

    const rows = await query<{
      id: number;
      code: string;
      name: string;
      area: string | null;
      seats: number;
      qr_token: string;
      branch_name: string | null;
      branch_address: string | null;
    }>(
      `SELECT t.id, t.code, t.name, t.area, t.seats, t.qr_token,
              b.name AS branch_name, b.address AS branch_address
         FROM rest_tables t
         LEFT JOIN branches b ON b.id = t.branch_id
        WHERE t.is_active AND (UPPER(t.code) = UPPER($1) OR t.qr_token = $1)
        LIMIT 1`,
      [q],
    );
    if (rows.length === 0) throw notFound('Không tìm thấy bàn này. Vui lòng quét lại mã QR trên bàn.');
    ok(res, rows[0]);
  }),
);

/** Bước sau khi quét QR: khách nhập tên + số điện thoại. */
const joinSchema = z.object({
  qrToken: z.string().trim().min(10, 'Mã QR không hợp lệ'),
  name: z.string().trim().min(2, 'Vui lòng nhập tên của bạn.').max(80),
  phone: z.string().trim().min(8, 'Số điện thoại không hợp lệ.').max(20),
});

publicRouter.post(
  '/session/join',
  asyncRoute(async (req, res) => {
    const body = joinSchema.parse(req.body);

    const tables = await query<{
      id: number;
      code: string;
      name: string;
      area: string | null;
      is_active: boolean;
      branch_name: string | null;
      branch_address: string | null;
    }>(
      `SELECT t.id, t.code, t.name, t.area, t.is_active,
              b.name AS branch_name, b.address AS branch_address
         FROM rest_tables t
         LEFT JOIN branches b ON b.id = t.branch_id
        WHERE t.qr_token = $1`,
      [body.qrToken],
    );
    const t = tables[0];
    if (!t) throw notFound('Mã QR không hợp lệ hoặc bàn đã bị vô hiệu hoá.');
    if (!t.is_active) throw badRequest('Bàn này hiện không phục vụ. Vui lòng gọi nhân viên.');

    const phone = normalizePhone(body.phone);
    if (!isValidVietnamPhone(phone)) throw badRequest('Số điện thoại không đúng định dạng Việt Nam.');

    const token = randomToken(24);
    const created = await query<{ token: string }>(
      `INSERT INTO table_sessions (token, table_id, customer_name, customer_phone)
       VALUES ($1, $2, $3, $4) RETURNING token`,
      [token, t.id, body.name, phone],
    );

    const session = await getSessionByToken(created[0].token);
    const draft = session ? await getOrCreateDraft(session) : null;

    ok(
      res,
      {
        token: created[0].token,
        table: {
          id: t.id,
          code: t.code,
          name: t.name,
          area: t.area,
          branch_name: t.branch_name,
          branch_address: t.branch_address,
        },
        customer_name: body.name,
        customer_phone: phone,
        order: draft,
      },
      201,
    );
  }),
);

/** Menu công khai kèm nhóm lựa chọn đi kèm của từng món. */
publicRouter.get(
  '/menu',
  asyncRoute(async (_req, res) => {
    const dishes = await query<Dish>(
      `SELECT id, name, description, category, image_url, price, is_available, is_active, sort_order
         FROM dishes WHERE is_active ORDER BY sort_order, id`,
    );

    const links = await query<{ dish_id: number; group_id: number }>(
      `SELECT dg.dish_id, dg.group_id
         FROM dish_option_groups dg
         JOIN option_groups g ON g.id = dg.group_id
        WHERE g.is_active
        ORDER BY dg.sort_order, g.sort_order`,
    );

    const groups = await query<DishOptionGroupRef>(
      `SELECT id, name, description, is_required, is_multiple, min_select, max_select, sort_order
         FROM option_groups WHERE is_active ORDER BY sort_order, id`,
    );

    const items = await query<OptionItem>(
      'SELECT * FROM option_items WHERE is_active ORDER BY sort_order, id',
    );

    const groupMap = new Map(groups.map((g) => [g.id, { ...g, items: [] as OptionItem[] }]));
    for (const it of items) groupMap.get(it.group_id)?.items.push(it);

    const byDish = new Map<number, DishOptionGroupRef[]>();
    for (const link of links) {
      const g = groupMap.get(link.group_id);
      if (!g) continue;
      const arr = byDish.get(link.dish_id) ?? [];
      arr.push(g);
      byDish.set(link.dish_id, arr);
    }

    const withGroups: Dish[] = dishes.map((d) => ({ ...d, option_groups: byDish.get(d.id) ?? [] }));
    const categories = [...new Set(withGroups.map((d) => d.category).filter(Boolean))] as string[];

    ok(res, { dishes: withGroups, categories, updatedAt: new Date().toISOString() });
  }),
);

/* ------------------------------------------------------------------ *
 *  PHẦN 2 - API màn hình khách (yêu cầu token phiên bàn)
 * ------------------------------------------------------------------ */

// LƯU Ý: phải giới hạn theo đường dẫn. `publicRouter` được mount ở '/api',
// nếu gắn middleware không có path thì nó sẽ chặn luôn /api/staff và /api/admin.
publicRouter.use('/order', attachTableToken, requireTableSession);
publicRouter.use('/session/me', attachTableToken, requireTableSession);

const requireSession = (req: import('express').Request) => {
  if (!req.tableToken) throw badRequest('Thiếu token phiên bàn.');
  return getSessionByToken(req.tableToken).then((s) => {
    if (!s) throw notFound('Phiên bàn không còn hợp lệ. Vui lòng quét lại mã QR.');
    return s;
  });
};

const requireDraft = async (req: import('express').Request) => {
  const session = await requireSession(req);
  return { session, order: await getOrCreateDraft(session) };
};

/**
 * LƯU Ý: khách KHÔNG xem được lịch sử order của mình.
 * Yêu cầu nghiệp vụ: lịch sử chỉ dành cho nhà hàng (nhân viên/Admin xem ở màn
 * Order, Thanh toán và trang Lịch sử của Admin) - khách chỉ theo dõi được
 * đơn đang order tại bàn qua màn "Chờ nhà hàng xác nhận".
 */
publicRouter.get(
  '/order/current',
  asyncRoute(async (req, res) => {
    const { order } = await requireDraft(req);
    ok(res, order);
  }),
);

/** Thêm món vào giỏ */
publicRouter.post(
  '/order/items',
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        dishId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(50).default(1),
        note: z.string().trim().max(200).optional().nullable(),
        selections: z
          .array(
            z.object({
              groupId: z.number().int().positive(),
              optionIds: z.array(z.number().int().positive()).max(20),
            }),
          )
          .max(20)
          .optional(),
      })
      .parse(req.body);

    const { session, order } = await requireDraft(req);
    const updated = await addItem(order, body, { type: 'customer', name: session.customer_name });
    ok(res, updated, 201);
  }),
);

/** Cập nhật số lượng (0 = xoá) */
publicRouter.patch(
  '/order/items/:itemId',
  asyncRoute(async (req, res) => {
    const { quantity } = z.object({ quantity: z.number().int().min(0).max(50) }).parse(req.body);
    const itemId = Number(req.params.itemId);
    if (!Number.isInteger(itemId)) throw badRequest('Mã món không hợp lệ.');

    const { session, order } = await requireDraft(req);
    ok(res, await updateItemQuantity(order, itemId, quantity, { type: 'customer', name: session.customer_name }));
  }),
);

/** Ghi chú cho cả đơn */
publicRouter.patch(
  '/order/note',
  asyncRoute(async (req, res) => {
    const { note } = z.object({ note: z.string().max(500).optional().nullable() }).parse(req.body);
    const { session, order } = await requireDraft(req);
    ok(res, await updateOrderNote(order, note ?? '', { type: 'customer', name: session.customer_name }));
  }),
);

/** Xoá toàn bộ giỏ */
publicRouter.delete(
  '/order/items',
  asyncRoute(async (req, res) => {
    const { session, order } = await requireDraft(req);
    ok(res, await clearItems(order, { type: 'customer', name: session.customer_name }));
  }),
);

/** Khách xác nhận -> chuyển sang màn chờ nhân viên xác nhận */
publicRouter.post(
  '/order/submit',
  asyncRoute(async (req, res) => {
    const { session, order } = await requireDraft(req);
    ok(res, await submitOrder(order, { type: 'customer', name: session.customer_name }));
  }),
);

/**
 * Khách bỏ phiên (không order nữa).
 *
 * Quét QR xong nhập tên/điện thoại nhưng khách đổi ý thì bấm "Huỷ phiên" ở giao diện
 * để đơn nháp không bị kẹt lại. Xoá cả đơn nháp lẫn phiên bàn để lần quét sau tạo
 * phiên mới hoàn toàn sạch (tránh dồn nhiều mã đơn rác).
 */
publicRouter.delete(
  '/order/session',
  asyncRoute(async (req, res) => {
    const session = await requireSession(req);

    // Chỉ xoá được đơn nháp; nếu khách đã gửi món thì giữ lại để nhà hàng xử lý.
    const draft = await queryOne<{ order_no: string }>(
      "SELECT order_no FROM orders WHERE session_token = $1 AND status = 'draft' LIMIT 1",
      [session.token],
    );
    let deletedDraft = false;
    if (draft) {
      const order = await getOrderByNo(draft.order_no);
      if (order) {
        await deleteDraftOrder(order);
        deletedDraft = true;
      }
    }

    await query('DELETE FROM table_sessions WHERE token = $1', [session.token]);

    ok(res, { deleted: true, deleted_draft: deletedDraft });
  }),
);

/** Theo dõi trạng thái 1 đơn (màn chờ phía khách) */
publicRouter.get(
  '/order/:orderNo',
  asyncRoute(async (req, res) => {
    const order = await getOrderByNo(req.params.orderNo, true);
    if (!order) throw notFound('Không tìm thấy đơn.');
    const session = await requireSession(req);
    if (order.customer_phone !== session.customer_phone) throw notFound('Không tìm thấy đơn.');
    ok(res, order);
  }),
);

/** Thông tin phiên bàn hiện tại */
publicRouter.get(
  '/session/me',
  asyncRoute(async (req, res) => {
    const s = await requireSession(req);
    // Ghi nhận hoạt động: dùng last_seen_at để dọn phiên bàn "bỏ quên" sau 24h.
    await query('UPDATE table_sessions SET last_seen_at = NOW() WHERE id = $1', [s.id]);
    ok(res, {
      token: s.token,
      customer_name: s.customer_name,
      customer_phone: s.customer_phone,
      table: {
        id: s.table_id,
        code: s.table_code,
        name: s.table_name,
        area: s.table_area,
        branch_name: s.branch_name,
      },
    });
  }),
);
