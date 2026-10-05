import { useEffect, useRef, useState } from 'react';

export type StreamEvent =
  | { type: 'hello'; kind: 'staff' | 'table' }
  | {
      type: 'order.created' | 'order.updated' | 'order.paid' | 'order.cancelled';
      orderNo: string;
      tableId: number | null;
      status: string;
    }
  | { type: 'menu.updated' | 'table.updated' }
  /** Admin vừa đăng/gỡ một thông báo nội bộ */
  | { type: 'announcement.updated' }
  | { type: 'heartbeat' };

/** Danh sách sự kiện server gửi. Thêm ở đây là đủ, không cần sửa thêm chỗ nào. */
const STREAM_TYPES: StreamEvent['type'][] = [
  'hello',
  'order.created',
  'order.updated',
  'order.paid',
  'order.cancelled',
  'menu.updated',
  'table.updated',
  'announcement.updated',
  'heartbeat',
];

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

      for (const t of STREAM_TYPES) {
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