import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, tokenStore } from '../../lib/http';
import { formatDateTime, formatMoney, timeAgo } from '../../lib/format';
import { useAsync } from '../../hooks/useAsync';
import { useLiveStream } from '../../hooks/useLiveStream';
import { useToast } from '../../components/Toast';
import { OrderTimeline } from '../../components/OrderBits';
import type { Order, OrderStatus } from '../../types';

/* ================================================================== *
 *  Các bước theo dõi
 * ================================================================== */

const STEPS: { key: OrderStatus; label: string; icon: string }[] = [
  { key: 'pending', label: 'Đã gửi đơn', icon: '📨' },
  { key: 'confirmed', label: 'Nhà hàng đã nhận', icon: '👨‍🍳' },
  { key: 'served', label: 'Đang phục vụ', icon: '🍽️' },
  { key: 'paid', label: 'Hoàn tất', icon: '✅' },
];

function stepIndex(status: OrderStatus): number {
  if (status === 'cancelled') return -1;
  const i = STEPS.findIndex((s) => s.key === status);
  return i < 0 ? 0 : i;
}

const WAIT_HINTS: Record<string, string> = {
  pending: 'Đơn của bạn đã được gửi tới nhà hàng. Nhân viên sẽ xác nhận trong chốc lát.',
  confirmed: 'Nhà hàng đã nhận đơn và đang chuẩn bị món cho bạn.',
  served: 'Món đã được phục vụ. Vui lòng kiểm tra và thanh toán tại bàn nhé.',
};

/* ================================================================== *
 *  Màn hình chờ
 * ================================================================== */

export function OrderStatusPage() {
  const { orderNo = '' } = useParams<{ orderNo: string }>();
  const nav = useNavigate();
  const toast = useToast();
  const tableToken = tokenStore.getTableToken();

  const state = useAsync<Order>(
    (signal) => api.get<Order>(`/order/${orderNo}`, { signal }),
    [orderNo, tableToken],
  );

  const [prevStatus, setPrevStatus] = useState<OrderStatus | null>(null);
  const order = state.data;

  useEffect(() => {
    if (!tableToken) nav('/', { replace: true });
  }, [tableToken, nav]);

  // Thông báo khi trạng thái đơn thay đổi
  useEffect(() => {
    if (!order) return;
    if (prevStatus && prevStatus !== order.status) {
      if (order.status === 'confirmed') toast.success('Nhà hàng đã xác nhận đơn của bạn!');
      else if (order.status === 'served') toast.info('Món đã được phục vụ. Vui lòng kiểm tra đơn.');
      else if (order.status === 'cancelled') toast.error(`Đơn đã bị huỷ: ${order.rejected_reason ?? 'không rõ lý do'}`);
      else if (order.status === 'paid') toast.success('Cảm ơn bạn! Đơn đã được thanh toán.');
    }
    setPrevStatus(order.status);
  }, [order, prevStatus, toast]);

  // Cập nhật thời gian thực
  useLiveStream(tableToken, (e) => {
    if (e.type.startsWith('order.') && (e as { orderNo: string }).orderNo === orderNo) {
      state.reload();
    }
  });

  // Dự phòng: polling mỗi 8s nếu SSE không hoạt động
  useEffect(() => {
    if (!order || order.status === 'paid' || order.status === 'cancelled') return;
    const t = window.setInterval(() => state.reload(), 8000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.status, orderNo]);

  if (state.loading && !order) return <div className="loading-box">Đang tải trạng thái đơn...</div>;

  if (state.error || !order) {
    return (
      <div className="c-status-page">
        <div className="c-status-wrap" style={{ paddingTop: 40 }}>
          <div className="alert alert-error">{state.error ?? 'Không tìm thấy đơn.'}</div>
          <Link className="btn btn-block" to="/menu">
            Về menu
          </Link>
        </div>
      </div>
    );
  }

  const idx = stepIndex(order.status);
  const isDone = order.status === 'paid';
  const isCancelled = order.status === 'cancelled';

  return (
    <div className="c-status-page">
      <div className="c-status-wrap">
        <header className="c-topbar" style={{ margin: '0 -14px 18px', position: 'static' }}>
          <div className="c-topbar-inner">
            <span className="c-table-pill">🪑 {order.table_name ?? '—'}</span>
            <div className="grow c-customer">{order.order_no}</div>
            <Link className="c-table-pill" to="/menu">
              Menu
            </Link>
          </div>
        </header>

        {/* Thẻ trạng thái chính */}
        <div className="card" style={{ padding: 22, textAlign: 'center', marginBottom: 18 }}>
          {isCancelled ? (
            <>
              <div style={{ fontSize: 52 }}>😔</div>
              <h2 className="danger-text mt-8" style={{ fontSize: 19 }}>Đơn đã bị huỷ</h2>
              {order.rejected_reason ? (
                <p className="small muted mt-6">
                  Lý do: {order.rejected_reason}
                </p>
              ) : null}
              <Link className="btn" style={{ marginTop: 16 }} to="/menu">
                Chọn món lại
              </Link>
            </>
          ) : isDone ? (
            <>
              <div style={{ fontSize: 52 }}>🎉</div>
              <h2 style={{ fontSize: 19, marginTop: 8 }}>Cảm ơn bạn!</h2>
              <p className="small muted mt-6">
                Đơn đã được thanh toán lúc {formatDateTime(order.paid_at)}
              </p>
            </>
          ) : (
            <>
              <div className="c-spinner-ring" />
              <h2 style={{ fontSize: 18.5, marginTop: 4 }}>
                {order.status === 'pending'
                  ? 'Đang chờ nhân viên xác nhận...'
                  : order.status === 'confirmed'
                    ? 'Nhà hàng đã nhận đơn!'
                    : 'Món đang được phục vụ'}
              </h2>
              <p className="small muted mt-6">
                {WAIT_HINTS[order.status] ?? 'Vui lòng chờ...'}
              </p>
              {order.received_by_name ? (
                <div className="badge badge-info" style={{ marginTop: 12 }}>
                  👨‍🍳 {order.received_by_name} đang phục vụ
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Thanh tiến trình */}
        {!isCancelled ? (
          <div className="card" style={{ padding: '18px 14px', marginBottom: 18 }}>
            <div className="c-progress">
              {STEPS.map((s, i) => (
                <div
                  key={s.key}
                  className={`c-step ${i < idx ? 'done' : ''} ${i === idx ? 'active' : ''}`}
                >
                  <div className="c-step-dot">{i < idx ? '✓' : s.icon}</div>
                  <div className="c-step-label">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Chi tiết món */}
        <div className="card mb-18">
          <div className="row-between wait-head">
            <h3 style={{ fontSize: 15 }}>Chi tiết đơn</h3>
            <span className="badge">{order.items.reduce((s, i) => s + i.quantity, 0)} món</span>
          </div>
          <div style={{ padding: '4px 16px 14px' }}>
            {order.items.map((it) => (
              <div className="c-receipt-line" key={it.id}>
                <div className="grow">
                  <div className="strong small">
                    {it.quantity}× {it.dish_name}
                  </div>
                  {it.options?.length ? (
                    <div className="c-opt-line">
                      {it.options.map((o, i) => (
                        <span key={i}>
                          {o.group_name}: {o.option_name}
                          {Number(o.price_delta) !== 0 ? ` (${Number(o.price_delta) > 0 ? '+' : ''}${formatMoney(o.price_delta)})` : ''}
                          {i < it.options.length - 1 ? ' · ' : ''}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {it.note ? <div className="c-opt-line">📝 {it.note}</div> : null}
                </div>
                <strong className="small nowrap">{formatMoney(it.line_total)}</strong>
              </div>
            ))}

            <div className="c-receipt-line" style={{ borderTop: '1.5px solid var(--line)', marginTop: 6, paddingTop: 12 }}>
              <strong>Tổng cộng</strong>
              <strong style={{ fontSize: 18, color: 'var(--brand-dark)' }}>{formatMoney(order.total)}</strong>
            </div>

            {order.status !== 'paid' ? (
              <div className="alert alert-info" style={{ marginTop: 14, marginBottom: 0 }}>
                💵 Vui lòng chuẩn bị <strong>{formatMoney(order.total)}</strong> và gọi nhân viên khi thanh toán.
              </div>
            ) : null}
          </div>
        </div>

        {/* Thông tin + nhật ký */}
        <div className="card mb-18">
          <div className="row-between wait-head">
            <h3 style={{ fontSize: 15 }}>Tiến trình</h3>
            <span className="tiny muted">{timeAgo(order.updated_at)}</span>
          </div>
          <div style={{ padding: 16 }}>
            <div className="o-meta mb-14">
              <div className="o-meta-item">
                <span className="k">Bàn:</span>
                <strong>{order.table_name ?? '—'}</strong>
              </div>
              <div className="o-meta-item">
                <span className="k">Bắt đầu:</span>
                <strong>{formatDateTime(order.started_at)}</strong>
              </div>
              {order.confirmed_at ? (
                <div className="o-meta-item">
                  <span className="k">Nhận order:</span>
                  <strong>{order.received_by_name ?? '—'}</strong>
                </div>
              ) : null}
              {order.paid_by_name ? (
                <div className="o-meta-item">
                  <span className="k">Thanh toán:</span>
                  <strong>{order.paid_by_name}</strong>
                </div>
              ) : null}
            </div>
            <OrderTimeline order={order} />
          </div>
        </div>

        <div className="row gap-10">
          <Link className="btn btn-secondary grow" to="/menu">
            Xem thực đơn
          </Link>
          <Link className="btn grow" to="/order/current">
            Giỏ hàng của tôi
          </Link>
        </div>
      </div>
    </div>
  );
}

