import { useSearchParams } from 'react-router-dom';
import { api, tokenStore } from '../../lib/http';
import { formatDateTime, formatTime } from '../../lib/format';
import { useAsync } from '../../hooks/useAsync';
import type { Order } from '../../types';

/* ================================================================== *
 *  IN ĐƠN BẾP — /kitchen/print?order=...
 *
 *  KHÔNG phải hoá đơn: đây là phiếu bếp dán ở bếp để nấu.
 *  Vì vậy trang này không có giá tiền, không có tổng cộng, không có phần
 *  thanh toán — chỉ đơn giản là: bàn nào, mã đơn, ai gọi món, và cần
 *  nấu những gì (kèm tuỳ chọn và ghi chú).
 *
 *  Đứng ngoài AppLayout để không bị sidebar/header khiến khổ giấy bị thu nhỏ.
 * ================================================================== */

export function KitchenPrintPage() {
  const [params] = useSearchParams();
  const orderNo = params.get('order') ?? '';

  const state = useAsync<Order>(
    (signal) => api.get<Order>(`/kitchen/orders/${encodeURIComponent(orderNo)}`, { signal }),
    [orderNo],
    { enabled: orderNo !== '' },
  );

  if (!tokenStore.getStaffToken()) {
    return (
      <div className="loading-box">
        Chưa đăng nhập. Quay lại <a href="/kitchen">bảng bếp</a> và bấm lại nút in.
      </div>
    );
  }

  if (orderNo === '') {
    return (
      <div className="empty">
        <div className="icon">🍳</div>
        <div>Thiếu mã đơn. Quay lại <a href="/kitchen">bảng bếp</a>.</div>
      </div>
    );
  }

  const o = state.data;

  return (
    <div className="kb-print-root">
      <div className="kb-print-bar no-print">
        <strong>🖨 Đơn bếp</strong>
        <span className="muted small">{orderNo}</span>
        <span className="grow" />
        <button className="btn btn-secondary btn-sm" onClick={() => window.close()} type="button">
          ✕ Đóng
        </button>
        <button className="btn btn-sm" disabled={!o} onClick={() => window.print()} type="button">
          🖨 In ngay
        </button>
      </div>

      {state.loading ? <div className="loading-box">Đang tải đơn...</div> : null}
      {state.error ? <div className="alert alert-error">{state.error}</div> : null}

      {o ? (
        <div className="kb-print-sheet">
          <header className="kb-print-head">
            <div className="ttl">PHIẾU BẾP</div>
            <div className="mono big">{o.order_no}</div>
          </header>

          <div className="kb-print-meta">
            <div>
              <span className="k">Bàn</span>
              <strong>{o.table_name ?? '—'}</strong>
            </div>
            <div>
              <span className="k">Khách</span>
              <strong>{o.customer_name}</strong>
            </div>
            <div>
              <span className="k">SĐT</span>
              <strong>{o.customer_phone}</strong>
            </div>
            <div>
              <span className="k">Giờ gọi</span>
              <strong>{formatTime(o.started_at)}</strong>
            </div>
            <div>
              <span className="k">Cơ sở</span>
              <strong>{o.table_branch_name ?? '—'}</strong>
            </div>
            <div>
              <span className="k">PV gửi</span>
              <strong>{o.received_by_name ?? '—'}</strong>
            </div>
          </div>

          {o.note ? <div className="kb-print-note">📝 Ghi chú đơn: {o.note}</div> : null}

          <table className="kb-print-tbl">
            <thead>
              <tr>
                <th className="c-qty">SL</th>
                <th>Món / Tuỳ chọn</th>
                <th className="c-done">Xong</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((it) => (
                <tr key={it.id}>
                  <td className="c-qty mono">{it.quantity}</td>
                  <td>
                    <div className="d">{it.dish_name}</div>
                    {it.options?.length ? (
                      <div className="o">
                        {it.options.map((op, i) => (
                          <span key={i}>
                            {op.group_name}: <strong>{op.option_name}</strong>
                            {i < it.options.length - 1 ? ' · ' : ''}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {it.note ? <div className="n">📝 {it.note}</div> : null}
                  </td>
                  {/* Ô vuông để bếp tick tay khi nấu xong món này */}
                  <td className="c-done">
                    <span className="box">{it.kitchen_done_at ? '☑' : '☐'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <footer className="kb-print-foot">
            <span>In lúc {formatDateTime(new Date().toISOString())}</span>
            <span>
              Tổng {o.items.reduce((s, i) => s + i.quantity, 0)} món ·{' '}
              {o.kitchen_received_by_name ? `Bếp nhận: ${o.kitchen_received_by_name}` : 'Bếp chưa nhận'}
            </span>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
