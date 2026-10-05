import { formatMoney } from '../api';
import { EVENT_LABEL, PAYMENT_LABEL, STATUS_LABEL, STATUS_TONE, type Order, type OrderStatus } from '../types';

export function StatusBadge({ status, className = '' }: { status: OrderStatus; className?: string }) {
  return (
    <span className={`badge badge-dot ${STATUS_TONE[status]} ${className}`}>{STATUS_LABEL[status]}</span>
  );
}

/** Danh sách món trong đơn (dùng cho cả nhân viên, admin và bill) */
export function OrderItems({ order, compact = false }: { order: Order; compact?: boolean }) {
  if (!order.items?.length) {
    return <div className="muted small">Chưa có món nào.</div>;
  }

  return (
    <div>
      {order.items.map((it) => (
        <div className="o-line" key={it.id}>
          <div className="o-line-qty">{it.quantity}×</div>
          <div className="grow">
            <div className="o-line-name">{it.dish_name}</div>
            {it.options?.length ? (
              <div className="o-line-opts">
                {it.options.map((o, i) => (
                  <span key={i}>
                    {o.group_name}: <strong>{o.option_name}</strong>
                    {o.price_delta !== 0 ? ` (+${formatMoney(o.price_delta)})` : ''}
                    {i < it.options.length - 1 ? ' · ' : ''}
                  </span>
                ))}
              </div>
            ) : null}
            {it.note ? <div className="o-line-opts">📝 {it.note}</div> : null}
            {!compact ? (
              <div className="tiny muted" style={{ marginTop: 2 }}>
                {formatMoney(it.unit_price)}
                {it.options_total > 0 ? ` + ${formatMoney(it.options_total)} tuỳ chọn` : ''}
              </div>
            ) : null}
          </div>
          <div className="o-line-price">{formatMoney(it.line_total)}</div>
        </div>
      ))}
    </div>
  );
}

export function OrderTotals({ order }: { order: Order }) {
  return (
    <div>
      <div className="o-line">
        <span className="muted small">Tạm tính</span>
        <span className="o-line-price">{formatMoney(order.subtotal)}</span>
      </div>
      {Number(order.discount) > 0 ? (
        <div className="o-line">
          <span className="muted small">Giảm trừ</span>
          <span className="o-line-price" style={{ color: 'var(--danger)' }}>
            −{formatMoney(order.discount)}
          </span>
        </div>
      ) : null}
      <div className="o-line" style={{ borderBottom: 'none', paddingTop: 10 }}>
        <span className="strong">Tổng cộng</span>
        <span className="o-line-price" style={{ fontSize: 19, color: 'var(--brand-dark)' }}>
          {formatMoney(order.total)}
        </span>
      </div>
    </div>
  );
}

/** Nhật ký thao tác của đơn */
export function OrderTimeline({ order }: { order: Order }) {
  const events = order.events ?? [];
  if (!events.length) return <div className="muted small">Chưa có thao tác nào.</div>;

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="c-timeline">
      {[...events].reverse().map((e) => {
        const isCancel = e.to_status === 'cancelled';
        return (
          <div className="c-timeline-item" key={e.id}>
            <div className={`c-timeline-dot ${isCancel ? 'red' : e.to_status === 'draft' ? 'grey' : ''}`} />
            <div className="grow">
              <div className="strong small">{EVENT_LABEL[e.event_type] ?? e.event_type}</div>
              <div className="tiny muted">
                {time(e.created_at)}
                {e.actor_name ? ` · ${e.actor_name}` : ''}
                {e.actor_type === 'staff' || e.actor_type === 'admin' ? ' (nhân viên)' : e.actor_type === 'customer' ? ' (khách)' : ''}
              </div>
              {typeof e.detail?.reason === 'string' && e.detail.reason ? (
                <div className="tiny" style={{ color: 'var(--danger)', marginTop: 3 }}>
                  Lý do: {e.detail.reason}
                </div>
              ) : null}
              {e.to_status === 'paid' && e.detail?.method ? (
                <div className="tiny muted" style={{ marginTop: 3 }}>
                  Hình thức: {PAYMENT_LABEL[e.detail.method as 'cash' | 'transfer'] ?? String(e.detail.method)}
                  {Number(e.detail.discount) > 0 ? ` · Giảm ${formatMoney(Number(e.detail.discount))}` : ''}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
