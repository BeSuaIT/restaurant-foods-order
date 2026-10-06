import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireKitchen, requireStaff } from '../middleware/auth.js';
import { asyncRoute, ok } from '../middleware/errors.js';
import { effectiveBranchFilter, listBranches } from '../services/branch.js';
import {
  dashboardStats,
  getOrderByNo,
  kitchenAcceptOrder,
  kitchenFinishOrder,
  listOrders,
  setKitchenItemDone,
} from '../services/order.service.js';
import { forbidden, notFound } from '../utils.js';
import type { Branch, Order } from '../types.js';

/**
 * API riêng cho phục vụ bếp.
 *
 * Bếp chỉ thấy đơn ở 2 bước liên quan tới mình: `sent_kitchen` (PV bàn vừa
 * chuyển qua, chờ bếp nhận) và `kitchen_accepted` (bếp đang làm). Bếp không
 * thấy danh sách đơn tổng, không xem hóa đơn, không xem giá trả khách.
 */
export const kitchenRouter = Router();

kitchenRouter.use(requireStaff, requireKitchen);

/** branch_id dùng để lọc: null = tất cả, -1 = không khớp. */
function branchFilter(req: Request): number | null {
  const f = effectiveBranchFilter(req, req.query.branch_id);
  return f === 'none' ? -1 : f;
}

/** Chặn bếp thao tác lên đơn thuộc cơ sở khác. */
function assertOrderAccess(req: Request, order: Order): void {
  const scope = req.staff!.branch_id ?? null;
  if (scope == null) return; // không gắn cơ sở = thấy tất cả
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

const kitchenOf = (req: Request) => ({
  id: req.staff!.id,
  full_name: req.staff!.full_name,
});

/* ------------------------------------------------------------------ *
 *  Bảng bếp
 * ------------------------------------------------------------------ */

/**
 * Đơn của bếp: gồm cả "chờ bếp nhận" lẫn "đang làm".
 * Trả về 2 mảng tách sẵn để UI không phải lọc lại:
 *   incoming — chuyển qua bếp, chờ nhận
 *   cooking  — bếp đã nhận, đang làm (kèm tiến độ tick món)
 */
kitchenRouter.get(
  '/orders',
  asyncRoute(async (req, res) => {
    const f = z
      .object({
        branch_id: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(req.query);

    const { rows } = await listOrders({
      statuses: ['sent_kitchen', 'kitchen_accepted'],
      branchId: branchFilter(req),
      from: f.from,
      to: f.to,
      limit: 200,
    });

    ok(res, {
      incoming: rows.filter((o) => o.status === 'sent_kitchen'),
      cooking: rows.filter((o) => o.status === 'kitchen_accepted'),
    });
  }),
);

kitchenRouter.get(
  '/orders/:orderNo',
  asyncRoute(async (req, res) => {
    const order = await loadOrderByNo(req, req.params.orderNo);
    ok(res, order);
  }),
);

/** ④ Bếp nhận đơn (từ bước chờ nhận sang đang làm). */
kitchenRouter.post(
  '/orders/:orderNo/accept',
  asyncRoute(async (req, res) => {
    const order = await loadOrderByNo(req, req.params.orderNo);
    ok(res, await kitchenAcceptOrder(order, kitchenOf(req)));
  }),
);

/** ④ Bếp tick món đã xong / bấm lại để bỏ tick. */
kitchenRouter.patch(
  '/orders/:orderNo/items/:itemId',
  asyncRoute(async (req, res) => {
    const itemId = z.coerce.number().int().positive().parse(req.params.itemId);
    const { done } = z.object({ done: z.boolean() }).parse(req.body ?? {});
    const order = await loadOrderByNo(req, req.params.orderNo);
    ok(res, await setKitchenItemDone(order, itemId, done, kitchenOf(req)));
  }),
);

/** ⑥ Bếp làm xong hết món, trả lại phục vụ bàn. */
kitchenRouter.post(
  '/orders/:orderNo/finish',
  asyncRoute(async (req, res) => {
    const order = await loadOrderByNo(req, req.params.orderNo);
    ok(res, await kitchenFinishOrder(order, kitchenOf(req)));
  }),
);

/* ------------------------------------------------------------------ *
 *  Thống kê & cơ sở
 * ------------------------------------------------------------------ */

/** Thống kê cho màn bếp: đang chờ nhận, đang làm, xong trong ngày. */
kitchenRouter.get(
  '/stats',
  asyncRoute(async (req, res) => {
    ok(res, await dashboardStats({ branchId: req.staff!.branch_id ?? null }));
  }),
);

/** Danh sách cơ sở để bếp lọc (bếp chỉ thấy cơ sở của mình). */
kitchenRouter.get(
  '/branches',
  asyncRoute(async (req, res) => {
    const all = await listBranches(true);
    const rows: Branch[] = all.filter((b) => b.id === req.staff!.branch_id);
    ok(res, rows);
  }),
);


