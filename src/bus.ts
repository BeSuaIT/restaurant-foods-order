import { EventEmitter } from 'node:events';

/**
 * Bus sự kiện in-memory để đẩy cập nhật trạng thái order tới khách hàng
 * và màn hình nhân viên/admin theo thời gian thực (SSE).
 *
 * Mỗi bản deploy chỉ có 1 tiến trình Node nên bus này là đủ.
 * Nếu sau này cần scale nhiều instance, thay lớp này bằng Redis Pub/Sub.
 */
export type BusEvent =
  | { type: 'order.created'; orderNo: string; tableId: number | null; status: string }
  | { type: 'order.updated'; orderNo: string; tableId: number | null; status: string }
  | { type: 'order.paid'; orderNo: string; tableId: number | null; status: string }
  | { type: 'order.cancelled'; orderNo: string; tableId: number | null; status: string }
  | { type: 'menu.updated' }
  | { type: 'table.updated' }
  | { type: 'heartbeat'; at: string };

class OrderBus extends EventEmitter {
  publish(event: BusEvent) {
    this.emit('change', event);
  }
}

export const bus = new OrderBus();
// Rất nhiều client cùng lúc -> tăng giới hạn listener mặc định
bus.setMaxListeners(0);

export const notifyOrderChanged = (
  orderNo: string,
  tableId: number | null,
  status: string,
  kind: 'order.created' | 'order.updated' | 'order.paid' | 'order.cancelled' = 'order.updated',
) => bus.publish({ type: kind, orderNo, tableId, status });
