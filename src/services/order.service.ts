import type { PoolClient } from 'pg';
import { pool, query, queryOne, withTransaction, type SqlParam } from '../db.js';
import { notifyOrderChanged } from '../bus.js';
import { badRequest, conflict, generateOrderNo, money, notFound } from '../utils.js';
import { checkDiscountCode, normalizeDiscountCode } from './branch.js';
import type {
  ActorType,
  DishOptionGroupRef,
  OptionGroup,
  OptionItem,
  Order,
  OrderEvent,
  OrderItem,
  OrderItemOption,
  OrderStatus,
  PaymentMethod,
} from '../types.js';

const ORDER_SELECT = `
  SELECT o.*,
         t.code   AS table_code,
         t.name   AS table_name,
         t.area   AS table_area,
         t.branch_id   AS table_branch_id,
         b.name   AS table_branch_name,
         b.address AS table_branch_address,
         b.phone AS table_branch_phone
  FROM orders o
  LEFT JOIN rest_tables t ON t.id = o.table_id
  LEFT JOIN branches    b ON b.id = t.branch_id
`;

/* ------------------------------------------------------------------ *
 *  Đọc dữ liệu
 * ------------------------------------------------------------------ */

export async function getOrderByNo(orderNo: string, withEvents = false): Promise<Order | null> {
  const row = await queryOne<Order>(`${ORDER_SELECT} WHERE o.order_no = $1`, [orderNo]);
  if (!row) return null;
  return hydrate(row, withEvents);
}

export async function getOrderById(id: number, withEvents = false): Promise<Order | null> {
  const row = await queryOne<Order>(`${ORDER_SELECT} WHERE o.id = $1`, [id]);
  if (!row) return null;
  return hydrate(row, withEvents);
}

/**
 * Gắn items + toàn bộ option của các đơn vào object `orders` (dùng chung cho
 * cả đơn đơn lẻ và danh sách, để bill in ra luôn kèm tuỳ chọn của khách).
 */
async function attachDetails(orders: Order[]): Promise<void> {
  if (orders.length === 0) return;
  const ids = orders.map((o) => o.id);

  const items = await query<OrderItem>(
    'SELECT * FROM order_items WHERE order_id = ANY($1::int[]) ORDER BY sort_order, id',
    [ids],
  );

  const optionRows = await query<OrderItemOption & { order_item_id: number }>(
    `SELECT oio.*
       FROM order_item_options oio
       JOIN order_items oi ON oi.id = oio.order_item_id
      WHERE oi.order_id = ANY($1::int[])
      ORDER BY oio.id`,
    [ids],
  );

  const optionsByItem = new Map<number, OrderItemOption[]>();
  for (const o of optionRows) {
    const list = optionsByItem.get(o.order_item_id) ?? [];
    list.push({ id: o.id, group_name: o.group_name, option_name: o.option_name, price_delta: o.price_delta });
    optionsByItem.set(o.order_item_id, list);
  }

  const byOrder = new Map<number, OrderItem[]>();
  for (const it of items) {
    const list = byOrder.get(it.order_id) ?? [];
    list.push({ ...it, options: optionsByItem.get(it.id) ?? [] });
    byOrder.set(it.order_id, list);
  }

  for (const o of orders) o.items = byOrder.get(o.id) ?? [];
}

async function hydrate(row: Order, withEvents: boolean): Promise<Order> {
  const result: Order = { ...row, items: [] };
  await attachDetails([result]);

  if (withEvents) {
    result.events = await query<OrderEvent>(
      'SELECT * FROM order_events WHERE order_id = $1 ORDER BY created_at, id',
      [row.id],
    );
  }

  return result;
}

/* ------------------------------------------------------------------ *
 *  Tính tiền & sự kiện
 * ------------------------------------------------------------------ */

/** Tính lại subtotal/total từ các dòng món. discount lưu trên order. */
export async function recalcTotals(client: PoolClient, orderId: number): Promise<{ subtotal: number; total: number }> {
  const res = await client.query<{ subtotal: string | number }>(
    `SELECT COALESCE(SUM(line_total), 0) AS subtotal FROM order_items WHERE order_id = $1`,
    [orderId],
  );
  const subtotal = money(Number(res.rows[0]?.subtotal ?? 0));

  const cur = await client.query<{ discount: string | number }>(
    'SELECT discount FROM orders WHERE id = $1',
    [orderId],
  );
  const discount = money(Number(cur.rows[0]?.discount ?? 0));
  const total = money(Math.max(0, subtotal - discount));

  await client.query('UPDATE orders SET subtotal = $2, total = $3 WHERE id = $1', [orderId, subtotal, total]);
  return { subtotal, total };
}

export interface EventInput {
  event_type: string;
  from_status?: OrderStatus | null;
  to_status?: OrderStatus | null;
  actor_type: ActorType;
  actor_id?: string | number | null;
  actor_name?: string | null;
  detail?: Record<string, unknown>;
}

export async function addEvent(client: PoolClient, orderId: number, e: EventInput): Promise<void> {
  await client.query(
    `INSERT INTO order_events
       (order_id, event_type, from_status, to_status, actor_type, actor_id, actor_name, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      orderId,
      e.event_type,
      e.from_status ?? null,
      e.to_status ?? null,
      e.actor_type,
      e.actor_id != null ? String(e.actor_id) : null,
      e.actor_name ?? null,
      JSON.stringify(e.detail ?? {}),
    ],
  );
}

/* ------------------------------------------------------------------ *
 *  Tạo / lấy phiên bàn & đơn nháp
 * ------------------------------------------------------------------ */

export interface SessionRow {
  id: number;
  token: string;
  table_id: number;
  customer_name: string;
  customer_phone: string;
  table_code: string;
  table_name: string;
  table_area: string | null;
  branch_id: number | null;
  branch_name: string | null;
}

export async function getSessionByToken(token: string): Promise<SessionRow | null> {
  return queryOne<SessionRow>(
    `SELECT s.id, s.token, s.table_id, s.customer_name, s.customer_phone,
            t.code AS table_code, t.name AS table_name, t.area AS table_area,
            t.branch_id, b.name AS branch_name
       FROM table_sessions s
       JOIN rest_tables t ON t.id = s.table_id
       LEFT JOIN branches  b ON b.id = t.branch_id
      WHERE s.token = $1`,
    [token],
  );
}

/** Lấy đơn nháp của phiên bàn, nếu chưa có thì tạo mới. */
export async function getOrCreateDraft(session: SessionRow): Promise<Order> {
  const existing = await queryOne<Order>(`${ORDER_SELECT} WHERE o.session_token = $1 AND o.status = 'draft'`, [
    session.token,
  ]);
  if (existing) return hydrate(existing, false);

  return withTransaction(async (client) => {
    // chống tạo trùng khi 2 request cùng lúc
    const again = await client.query(`${ORDER_SELECT} WHERE o.session_token = $1 AND o.status = 'draft'`, [
      session.token,
    ]);
    if (again.rows[0]) {
      const ord = again.rows[0] as Order;
      const items = await client.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY sort_order, id', [
        ord.id,
      ]);
      return { ...ord, items: items.rows as OrderItem[] };
    }

    const orderNo = await uniqueOrderNo(client);
    const ins = await client.query<Order>(
      `INSERT INTO orders (order_no, table_id, session_token, customer_name, customer_phone, status, started_at)
       VALUES ($1, $2, $3, $4, $5, 'draft', NOW())
       RETURNING *`,
      [orderNo, session.table_id, session.token, session.customer_name, session.customer_phone],
    );
    const order = ins.rows[0];
    await addEvent(client, order.id, {
      event_type: 'created',
      to_status: 'draft',
      actor_type: 'customer',
      actor_name: session.customer_name,
      detail: { table: session.table_name },
    });
    return { ...order, table_code: session.table_code, table_name: session.table_name, table_area: session.table_area, items: [] };
  });
}

async function uniqueOrderNo(client: PoolClient): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const no = generateOrderNo();
    const exists = await client.query('SELECT 1 FROM orders WHERE order_no = $1', [no]);
    if (exists.rowCount === 0) return no;
  }
  throw conflict('Không tạo được mã đơn. Vui lòng thử lại.');
}

/* ------------------------------------------------------------------ *
 *  Thêm / sửa / xoá món trong đơn nháp
 * ------------------------------------------------------------------ */

export interface AddItemInput {
  dishId: number;
  quantity: number;
  note?: string | null;
  /** Danh sách option đã chọn: [{ groupId, optionIds: [] }] */
  selections?: { groupId: number; optionIds: number[] }[];
}

export const EDITABLE_STATUSES: OrderStatus[] = ['draft'];

/*
 * LƯU Ý QUAN TRỌNG:
 * Mọi hàm bên dưới ghi trong `withTransaction` rồi ĐỌC LẠI bằng `getOrderById`
 * (dùng pool - tức là connection khác). Connection đó KHÔNG nhìn thấy dữ liệu
 * chưa commit, nên phải đọc lại SAU khi transaction đã commit.
 */

export async function addItem(order: Order, input: AddItemInput, actor: { type: ActorType; name: string }): Promise<Order> {
  const qty = Math.trunc(input.quantity);
  if (!Number.isFinite(qty) || qty < 1 || qty > 50) throw badRequest('Số lượng phải từ 1 đến 50.');

  await withTransaction(async (client) => {
    const dish = await loadDishForOrder(client, input.dishId);
    const groups = await loadDishOptionGroups(client, dish.id);
    const chosen = validateSelections(groups, input.selections ?? []);

    const optionsTotal = money(chosen.reduce((s, o) => s + o.price_delta, 0));
    const unitPrice = money(Number(dish.price));
    const lineTotal = money((unitPrice + optionsTotal) * qty);

    const maxSort = await client.query<{ max: number | null }>(
      'SELECT COALESCE(MAX(sort_order), -1) AS max FROM order_items WHERE order_id = $1',
      [order.id],
    );

    const ins = await client.query<{ id: number }>(
      `INSERT INTO order_items
         (order_id, dish_id, dish_name, dish_image_url, unit_price, quantity, note, options_total, line_total, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        order.id,
        dish.id,
        dish.name,
        dish.image_url,
        unitPrice,
        qty,
        input.note?.trim() || null,
        optionsTotal,
        lineTotal,
        Number(maxSort.rows[0]?.max ?? -1) + 1,
      ],
    );

    for (const o of chosen) {
      await client.query(
        `INSERT INTO order_item_options (order_item_id, group_name, option_name, price_delta) VALUES ($1,$2,$3,$4)`,
        [ins.rows[0].id, o.group_name, o.option_name, o.price_delta],
      );
    }

    await recalcTotals(client, order.id);
    await addEvent(client, order.id, {
      event_type: 'item_added',
      actor_type: actor.type,
      actor_name: actor.name,
      detail: {
        dish: dish.name,
        quantity: qty,
        options: chosen.map((o) => o.option_name),
        line_total: lineTotal,
      },
    });
  });

  const updated = await getOrderById(order.id);
  return updated!;
}

export async function updateItemQuantity(
  order: Order,
  itemId: number,
  quantity: number,
  actor: { type: ActorType; name: string },
): Promise<Order> {
  const qty = Math.trunc(quantity);
  await withTransaction(async (client) => {
    const item = await client.query<OrderItem>('SELECT * FROM order_items WHERE id = $1 AND order_id = $2', [
      itemId,
      order.id,
    ]);
    if (item.rowCount === 0) throw notFound('Không tìm thấy món trong đơn.');

    if (qty <= 0) {
      await client.query('DELETE FROM order_items WHERE id = $1', [itemId]);
      await addEvent(client, order.id, {
        event_type: 'item_removed',
        actor_type: actor.type,
        actor_name: actor.name,
        detail: { dish: item.rows[0].dish_name },
      });
    } else {
      if (qty > 50) throw badRequest('Số lượng tối đa là 50.');
      await client.query('UPDATE order_items SET quantity = $2, line_total = $3 WHERE id = $1', [
        itemId,
        qty,
        money((Number(item.rows[0].unit_price) + Number(item.rows[0].options_total)) * qty),
      ]);
      await addEvent(client, order.id, {
        event_type: 'item_updated',
        actor_type: actor.type,
        actor_name: actor.name,
        detail: { dish: item.rows[0].dish_name, quantity: qty },
      });
    }

    await recalcTotals(client, order.id);
  });

  return (await getOrderById(order.id))!;
}

export async function removeItem(
  order: Order,
  itemId: number,
  actor: { type: ActorType; name: string },
): Promise<Order> {
  return updateItemQuantity(order, itemId, 0, actor);
}

export async function updateOrderNote(order: Order, note: string, actor: { type: ActorType; name: string }): Promise<Order> {
  await withTransaction(async (client) => {
    await client.query('UPDATE orders SET note = $2 WHERE id = $1', [order.id, note.trim() || null]);
    await addEvent(client, order.id, { event_type: 'note_updated', actor_type: actor.type, actor_name: actor.name });
  });

  return (await getOrderById(order.id))!;
}

export async function clearItems(order: Order, actor: { type: ActorType; name: string }): Promise<Order> {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM order_items WHERE order_id = $1', [order.id]);
    await recalcTotals(client, order.id);
    await addEvent(client, order.id, {
      event_type: 'items_cleared',
      actor_type: actor.type,
      actor_name: actor.name,
    });
  });

  return (await getOrderById(order.id))!;
}

/* ------------------------------------------------------------------ *
 *  Chuyển trạng thái
 * ------------------------------------------------------------------ */

/** Khách bấm "Gửi đơn" -> chờ nhân viên xác nhận */
export async function submitOrder(order: Order, actor: { type: ActorType; name: string }): Promise<Order> {
  if (order.status !== 'draft') {
    if (order.status === 'pending' || order.status === 'confirmed' || order.status === 'served') return order;
    throw conflict('Đơn này không ở trạng thái chờ gửi.');
  }
  if (order.items.length === 0) throw badRequest('Đơn chưa có món nào.');

  await withTransaction(async (client) => {
    const { rows } = await client.query<{ status: OrderStatus }>(
      "UPDATE orders SET status = 'pending' WHERE id = $1 AND status = 'draft' RETURNING status",
      [order.id],
    );
    if (rows.length === 0) throw conflict('Đơn vừa được cập nhật. Vui lòng tải lại.');

    await recalcTotals(client, order.id);
    await addEvent(client, order.id, {
      event_type: 'submitted',
      from_status: 'draft',
      to_status: 'pending',
      actor_type: actor.type,
      actor_name: actor.name,
      detail: { item_count: order.items.length, total: order.total },
    });
  });

  const updated = (await getOrderById(order.id))!;
  notifyOrderChanged(updated.order_no, updated.table_id, updated.status, 'order.created');
  return updated;
}

/** Nhân viên xác nhận nhận order */
export async function confirmOrder(
  order: Order,
  staff: { id: number; full_name: string },
): Promise<Order> {
  if (order.status !== 'pending') throw conflict('Chỉ đơn đang chờ xác nhận mới có thể nhận.');

  await withTransaction(async (client) => {
    const { rows } = await client.query<{ status: OrderStatus }>(
      `UPDATE orders
          SET status = 'confirmed', received_by = $2, received_by_name = $3, confirmed_at = NOW()
        WHERE id = $1 AND status = 'pending'
        RETURNING status`,
      [order.id, staff.id, staff.full_name],
    );
    if (rows.length === 0) throw conflict('Đơn vừa được cập nhật bởi nhân viên khác.');

    await addEvent(client, order.id, {
      event_type: 'confirmed',
      from_status: 'pending',
      to_status: 'confirmed',
      actor_type: 'staff',
      actor_id: staff.id,
      actor_name: staff.full_name,
    });
  });

  const updated = (await getOrderById(order.id))!;
  notifyOrderChanged(updated.order_no, updated.table_id, updated.status);
  return updated;
}

/** Nhân viên từ chối / huỷ đơn */
export async function rejectOrder(order: Order, staff: { id: number; full_name: string }, reason: string): Promise<Order> {
  if (order.status === 'paid') throw conflict('Đơn đã thanh toán, không thể huỷ.');
  if (order.status === 'cancelled') throw conflict('Đơn đã bị huỷ.');

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE orders SET status = 'cancelled', rejected_reason = $2 WHERE id = $1`,
      [order.id, reason.trim() || null],
    );
    await addEvent(client, order.id, {
      event_type: 'cancelled',
      from_status: order.status,
      to_status: 'cancelled',
      actor_type: 'staff',
      actor_id: staff.id,
      actor_name: staff.full_name,
      detail: { reason: reason.trim() || null },
    });
  });

  const updated = (await getOrderById(order.id))!;
  notifyOrderChanged(updated.order_no, updated.table_id, updated.status, 'order.cancelled');
  return updated;
}

/** Đánh dấu đã phục vụ xong món */
export async function markServed(order: Order, staff: { id: number; full_name: string }): Promise<Order> {
  if (order.status !== 'confirmed') throw conflict('Chỉ đơn đã xác nhận mới chuyển sang đã phục vụ.');

  await withTransaction(async (client) => {
    await client.query(`UPDATE orders SET status = 'served', served_at = NOW(), served_by = $2 WHERE id = $1`, [
      order.id,
      staff.id,
    ]);
    await addEvent(client, order.id, {
      event_type: 'served',
      from_status: 'confirmed',
      to_status: 'served',
      actor_type: 'staff',
      actor_id: staff.id,
      actor_name: staff.full_name,
    });
  });

  const updated = (await getOrderById(order.id))!;
  notifyOrderChanged(updated.order_no, updated.table_id, updated.status);
  return updated;
}

/** Mở lại đơn đã phục vụ về trạng thái đang xác nhận */
export async function unservedOrder(order: Order, staff: { id: number; full_name: string }): Promise<Order> {
  if (order.status !== 'served') throw conflict('Chỉ đơn đã phục vụ mới mở lại được.');
  await withTransaction(async (client) => {
    await client.query(`UPDATE orders SET status = 'confirmed', served_at = NULL, served_by = NULL WHERE id = $1`, [
      order.id,
    ]);
    await addEvent(client, order.id, {
      event_type: 'unserved',
      from_status: 'served',
      to_status: 'confirmed',
      actor_type: 'staff',
      actor_id: staff.id,
      actor_name: staff.full_name,
    });
  });

  const updated = (await getOrderById(order.id))!;
  notifyOrderChanged(updated.order_no, updated.table_id, updated.status);
  return updated;
}

export interface PaymentInput {
  method: PaymentMethod;
  /** Giảm trừ thủ công (đồng). Ưu tiên thấp hơn mã giảm giá. */
  discount?: number;
  /** Mã giảm giá khách/nhân viên nhập (VD: "GIAM10") */
  discountCode?: string | null;
  note?: string | null;
}

/**
 * Xác nhận đã thanh toán.
 * - cash: nhân viên bấm sau khi khách đưa tiền mặt.
 * - transfer: (đang để mở) hiện chưa mở trong UI.
 */
export async function markPaid(
  order: Order,
  staff: { id: number; full_name: string },
  input: PaymentInput,
): Promise<Order> {
  if (order.status === 'paid') throw conflict('Đơn này đã thanh toán rồi.');
  if (order.status === 'draft') throw conflict('Đơn chưa được gửi cho nhà hàng.');
  if (order.status === 'cancelled') throw conflict('Đơn đã bị huỷ.');

  // Kiểm tra mã giảm giá (nếu có) TRƯỚC khi mở transaction.
  let dc: Awaited<ReturnType<typeof checkDiscountCode>> | null = null;
  const rawCode = normalizeDiscountCode(input.discountCode);
  if (rawCode) dc = await checkDiscountCode(rawCode, Number(order.subtotal));

  await withTransaction(async (client) => {
    if (dc) {
      await client.query(
        `UPDATE orders
            SET discount_code_id = $2, discount_code = $3, discount_percent = $4,
                discount_amount = $5, discount = $5
          WHERE id = $1`,
        [order.id, dc.code.id, dc.code.code, dc.code.percent, money(dc.amount)],
      );
    } else if (input.discount != null) {
      const maxDiscount = money(Number(order.subtotal));
      if (input.discount < 0 || input.discount > maxDiscount) {
        throw badRequest('Số tiền giảm trừ không hợp lệ.');
      }
      await client.query(
        `UPDATE orders SET discount = $2, discount_code_id = NULL, discount_code = NULL,
                           discount_percent = 0, discount_amount = $2
          WHERE id = $1`,
        [order.id, money(input.discount)],
      );
    }
    await recalcTotals(client, order.id);

    const { rows } = await client.query<{ status: OrderStatus }>(
      `UPDATE orders
          SET status = 'paid',
              payment_method = $2,
              paid_at = NOW(),
              paid_by = $3,
              paid_by_name = $4
        WHERE id = $1 AND status <> 'paid'
        RETURNING status`,
      [order.id, input.method, staff.id, staff.full_name],
    );
    if (rows.length === 0) throw conflict('Đơn vừa được thanh toán bởi nhân viên khác.');

    if (dc) {
      await client.query('UPDATE discount_codes SET used_count = used_count + 1 WHERE id = $1', [dc.code.id]);
    }

    await addEvent(client, order.id, {
      event_type: 'paid',
      from_status: order.status,
      to_status: 'paid',
      actor_type: 'staff',
      actor_id: staff.id,
      actor_name: staff.full_name,
      detail: {
        method: input.method,
        discount: dc ? money(dc.amount) : (input.discount ?? 0),
        discount_code: dc?.code.code ?? null,
        discount_percent: dc?.code.percent ?? 0,
        note: input.note ?? null,
      },
    });
  });

  const updated = (await getOrderById(order.id, true))!;
  notifyOrderChanged(updated.order_no, updated.table_id, updated.status, 'order.paid');
  return updated;
}

/* ------------------------------------------------------------------ *
 *  Load món & option
 * ------------------------------------------------------------------ */

async function loadDishForOrder(client: PoolClient, dishId: number) {
  const res = await client.query<{
    id: number;
    name: string;
    price: string | number;
    image_url: string | null;
    is_available: boolean;
    is_active: boolean;
  }>('SELECT id, name, price, image_url, is_available, is_active FROM dishes WHERE id = $1', [dishId]);

  const dish = res.rows[0];
  if (!dish || !dish.is_active) throw notFound('Món ăn không tồn tại hoặc đã bị ẩn khỏi menu.');
  if (!dish.is_available) throw badRequest(`Món "${dish.name}" hiện đã hết. Vui lòng chọn món khác.`);
  return dish;
}

async function loadDishOptionGroups(client: PoolClient, dishId: number): Promise<DishOptionGroupRef[]> {
  const res = await client.query<DishOptionGroupRef>(
    `SELECT g.id, g.name, g.description, g.is_required, g.is_multiple, g.min_select, g.max_select, g.sort_order
       FROM dish_option_groups dg
       JOIN option_groups g ON g.id = dg.group_id
      WHERE dg.dish_id = $1 AND g.is_active
      ORDER BY dg.sort_order, g.sort_order, g.id`,
    [dishId],
  );

  if (res.rows.length === 0) return [];

  const ids = res.rows.map((g) => g.id);
  const items = await client.query<OptionItem>(
    `SELECT * FROM option_items WHERE group_id = ANY($1::int[]) AND is_active ORDER BY sort_order, id`,
    [ids],
  );

  return res.rows.map((g) => ({
    ...g,
    items: items.rows.filter((i) => i.group_id === g.id),
  }));
}

interface ChosenOption {
  group_name: string;
  option_name: string;
  price_delta: number;
}

/** Kiểm tra lựa chọn của khách và lấy giá từ DB (không tin giá do client gửi). */
export function validateSelections(
  groups: DishOptionGroupRef[],
  selections: { groupId: number; optionIds: number[] }[],
): ChosenOption[] {
  const result: ChosenOption[] = [];

  for (const group of groups) {
    const sel = selections.find((s) => Number(s.groupId) === Number(group.id));
    const ids = (sel?.optionIds ?? []).map((n) => Number(n));

    if (ids.length === 0) {
      if (group.is_required || group.min_select > 0) {
        throw badRequest(`Vui lòng chọn "${group.name}".`);
      }
      continue;
    }
    if (ids.length > group.max_select) {
      throw badRequest(`Chỉ được chọn tối đa ${group.max_select} mục cho "${group.name}".`);
    }
    if (ids.length < group.min_select) {
      throw badRequest(`Cần chọn ít nhất ${group.min_select} mục cho "${group.name}".`);
    }
    if (!group.is_multiple && ids.length > 1) {
      throw badRequest(`Chỉ được chọn 1 mục cho "${group.name}".`);
    }

    for (const id of ids) {
      const item = group.items.find((i) => i.id === id);
      if (!item) throw badRequest(`Lựa chọn không hợp lệ trong nhóm "${group.name}".`);
      result.push({
        group_name: group.name,
        option_name: item.name,
        price_delta: money(Number(item.price_delta)),
      });
    }
  }

  return result;
}

/* ------------------------------------------------------------------ *
 *  Bảng điều khiển nhân viên
 * ------------------------------------------------------------------ */

export interface StaffOrdersFilter {
  statuses?: OrderStatus[];
  tableId?: number;
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  offset?: number;
  /**
   * Lọc theo cơ sở.
   *  null            -> không lọc (Admin xem tất cả)
   *  NO_BRANCH (-1)  -> không đơn nào khớp (nhân viên chưa gán cơ sở)
   */
  branchId?: number | null;
}

export async function listOrders(filter: StaffOrdersFilter): Promise<{ rows: Order[]; total: number }> {
  const where: string[] = ['1 = 1'];
  const params: SqlParam[] = [];

  if (filter.branchId != null) {
    params.push(filter.branchId);
    where.push(`t.branch_id = $${params.length}`);
  }
  if (filter.statuses?.length) {
    params.push(filter.statuses);
    where.push(`o.status = ANY($${params.length}::order_status[])`);
  }
  if (filter.tableId) {
    params.push(filter.tableId);
    where.push(`o.table_id = $${params.length}`);
  }
  if (filter.from) {
    params.push(filter.from);
    where.push(`o.created_at >= $${params.length}`);
  }
  if (filter.to) {
    params.push(filter.to);
    where.push(`o.created_at <= $${params.length}`);
  }
  if (filter.q) {
    params.push(`%${filter.q}%`);
    const i = params.length;
    where.push(`(o.order_no ILIKE $${i} OR o.customer_name ILIKE $${i} OR o.customer_phone ILIKE $${i} OR t.code ILIKE $${i})`);
  }

  const clause = where.join(' AND ');
  const totalRow = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM orders o LEFT JOIN rest_tables t ON t.id = o.table_id WHERE ${clause}`,
    params,
  );

  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  params.push(limit, offset);

  const rows = await query<Order>(`${ORDER_SELECT} WHERE ${clause} ORDER BY o.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

  // gắn items + option cho các đơn trả về (bill cần hiện tuỳ chọn của khách)
  await attachDetails(rows);

  return { rows, total: totalRow?.count ?? 0 };
}

export interface StatsFilter {
  /** null = tất cả cơ sở; NO_BRANCH = không có đơn nào */
  branchId?: number | null;
}

export async function dashboardStats(filter: StatsFilter = {}) {
  const branch = filter.branchId;
  const bClause = branch != null ? ' AND t.branch_id = $1' : '';
  const bParams: SqlParam[] = branch != null ? [branch] : [];

  const [today] = await query<{
    orders: number;
    revenue: number;
    items: number;
    paid_cash: number;
  }>(
    `SELECT
       COUNT(*)::int                                        AS orders,
       COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.total ELSE 0 END), 0) AS revenue,
       COALESCE(SUM((SELECT COALESCE(SUM(quantity),0) FROM order_items oi WHERE oi.order_id = o.id)), 0) AS items,
       COALESCE(SUM(CASE WHEN o.status = 'paid' AND o.payment_method = 'cash' THEN o.total ELSE 0 END), 0) AS paid_cash
     FROM orders o
     LEFT JOIN rest_tables t ON t.id = o.table_id
     WHERE (o.status <> 'draft' OR o.created_at >= date_trunc('day', now()))${bClause}`,
    bParams,
  );

  const countRows = await query<{ status: string; count: number }>(
    `SELECT o.status::text AS status, COUNT(*)::int AS count
       FROM orders o
       LEFT JOIN rest_tables t ON t.id = o.table_id
      WHERE 1 = 1${bClause}
      GROUP BY o.status`,
    bParams,
  );

  const topDishes = await query<{ name: string; quantity: number; revenue: number }>(
    `SELECT oi.dish_name AS name,
            SUM(oi.quantity)::int AS quantity,
            COALESCE(SUM(oi.line_total), 0) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN rest_tables t ON t.id = o.table_id
      WHERE o.status = 'paid'
        AND o.paid_at >= date_trunc('day', now())
        ${branch != null ? 'AND t.branch_id = $1' : ''}
      GROUP BY oi.dish_name
      ORDER BY quantity DESC
      LIMIT 8`,
    bParams,
  );

  const recentStaff = await query<{
    full_name: string;
    received: number;
    paid: number;
  }>(
    `SELECT u.full_name,
            COUNT(*) FILTER (WHERE o.received_by = u.id)::int AS received,
            COUNT(*) FILTER (WHERE o.paid_by = u.id)::int      AS paid
       FROM orders o
       JOIN users u ON u.id IN (o.received_by, o.paid_by)
       LEFT JOIN rest_tables t ON t.id = o.table_id
      WHERE o.status = 'paid' AND o.paid_at >= date_trunc('day', now())
        ${branch != null ? 'AND t.branch_id = $1' : ''}
      GROUP BY u.full_name
      ORDER BY (COUNT(*) FILTER (WHERE o.paid_by = u.id)) DESC
      LIMIT 10`,
    bParams,
  );

  const countMap: Record<string, number> = {};
  for (const c of countRows ?? []) countMap[c.status] = Number(c.count);

  return {
    today: {
      orders: today?.orders ?? 0,
      revenue: money(today?.revenue ?? 0),
      items: today?.items ?? 0,
      cash: money(today?.paid_cash ?? 0),
    },
    counts: {
      draft: countMap.draft ?? 0,
      pending: countMap.pending ?? 0,
      confirmed: countMap.confirmed ?? 0,
      served: countMap.served ?? 0,
      paid: countMap.paid ?? 0,
      cancelled: countMap.cancelled ?? 0,
    },
    topDishes,
    recentStaff,
  };
}

export { pool };
