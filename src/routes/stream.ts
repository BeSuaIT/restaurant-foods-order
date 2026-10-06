import { Router } from 'express';
import { bus, type BusEvent } from '../bus.js';
import { getSessionByToken } from '../services/order.service.js';
import { verifyStaffToken } from '../auth.js';
import { asyncRoute } from '../middleware/errors.js';

export const streamRouter = Router();

type Client = {
  id: number;
  /** staff = theo dõi toàn bộ, table = chỉ bàn của mình */
  kind: 'staff' | 'table';
  tableId: number | null;
  phone: string | null;
};

const clients = new Map<number, Client>();
let nextId = 1;

/**
 * Server-Sent Events để cập nhật trạng thái order theo thời gian thực.
 * - Nhân viên / Admin: nhận mọi thay đổi của đơn và menu.
 * - Khách hàng: chỉ nhận thay đổi của đơn tại bàn mình (và menu).
 *
 * EventSource không gắn được header Authorization nên nhận token qua query string.
 */
streamRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const token = String(req.query.token ?? '').trim();
    if (!token) {
      res.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: 'Thiếu token.' });
      return;
    }

    let client: Client;

    // 1) thử token phiên bàn của khách
    const session = await getSessionByToken(token);
    if (session) {
      client = { id: nextId++, kind: 'table', tableId: session.table_id, phone: session.customer_phone };
    } else {
      // 2) thử JWT của nhân viên / admin
      try {
        const payload = verifyStaffToken(token);
        client = { id: nextId++, kind: 'staff', tableId: null, phone: payload.username };
      } catch {
        res.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: 'Token không hợp lệ.' });
        return;
      }
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // tắt buffering của nginx
    });
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('hello', { ok: true, kind: client.kind, at: new Date().toISOString() });
    clients.set(client.id, client);

    const onChange = (evt: BusEvent) => {
      // Sự kiện menu/bàn chỉ gửi cho nhân viên & admin
      if (evt.type === 'menu.updated' || evt.type === 'table.updated' || evt.type === 'heartbeat') {
        send(evt.type, { at: new Date().toISOString() });
        return;
      }
      if (client.kind === 'staff') {
        send(evt.type, evt);
        return;
      }
      // khách: lọc theo bàn (nếu event có tableId)
      if (evt.tableId != null && evt.tableId === client.tableId) {
        send(evt.type, evt);
      }
    };

    const heartbeat = setInterval(() => {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    }, 25_000);

    bus.on('change', onChange);

    const cleanup = () => {
      clearInterval(heartbeat);
      bus.off('change', onChange);
      clients.delete(client.id);
    };

    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  }),
);

export const streamStats = () => ({ clients: clients.size });
