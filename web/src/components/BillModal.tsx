import { useEffect } from 'react';
import { api, durationBetween, formatDateTime, formatMoneyPlain, useAsync } from '../api';
import type { Order } from '../types';
import { PAYMENT_LABEL } from '../types';

/* ================================================================== *
 *  HÓA ĐƠN (bill nhiệt 80mm)
 *
 *  Yêu cầu: xem bill phải là POPUP đè lên giao diện chính (nền tối kiểu
 *  preview ảnh), không phải một trang riêng. Chỉ còn 1 chức năng in là
 *  in hóa đơn này.
 * ================================================================== */

interface BillSheetProps {
  order: Order;
  shopName?: string;
  shopAddress?: string | null;
}

/** Nội dung hóa đơn dạng khổ giấy nhiệt 80mm (dùng chung cho màn xem & in). */
export function BillSheet({ order: o, shopName, shopAddress }: BillSheetProps) {
  const name = shopName || o.table_branch_name || 'NHÀ HÀNG';
  // Địa chỉ in trên bill: ưu tiên địa chỉ cơ sở của bàn (nếu có)
  const addr = shopAddress || o.table_branch_address || '';

  return (
    <div className="bill-page">
      <div className="bill-head">
        <div className="shop">{name}</div>
        {addr ? <div className="addr">{addr}</div> : null}
        {o.table_branch_phone ? (
          <div className="addr">☎ {o.table_branch_phone}</div>
        ) : null}
      </div>

      <div className="bill-title">HÓA ĐƠN THANH TOÁN</div>

      <div className="bill-info">
        <div className="bi-row">
          <span className="k">Số hóa đơn:</span>
          <strong>{o.order_no}</strong>
        </div>
        <div className="bi-row">
          <span className="k">Bàn:</span>
          <strong>
            {o.table_name ?? '—'}
            {o.table_code ? ` (${o.table_code})` : ''}
          </strong>
        </div>
        {o.table_area ? (
          <div className="bi-row">
            <span className="k">Khu vực:</span>
            <span>{o.table_area}</span>
          </div>
        ) : null}
        {/* Khi tên bill lấy từ tên cơ sở thì không cần in lại dòng "Cơ sở" */}
        {o.table_branch_name && shopName ? (
          <div className="bi-row">
            <span className="k">Cơ sở:</span>
            <span>{o.table_branch_name}</span>
          </div>
        ) : null}
        <div className="bi-row">
          <span className="k">Khách hàng:</span>
          <strong>{o.customer_name}</strong>
        </div>
        <div className="bi-row">
          <span className="k">Điện thoại:</span>
          <span>{o.customer_phone}</span>
        </div>
        <div className="bi-row">
          <span className="k">Bắt đầu order:</span>
          <span>{formatDateTime(o.started_at)}</span>
        </div>
        <div className="bi-row">
          <span className="k">Nhận đơn lúc:</span>
          <span>{o.confirmed_at ? formatDateTime(o.confirmed_at) : '—'}</span>
        </div>
        <div className="bi-row">
          <span className="k">Phục vụ xong:</span>
          <span>{o.served_at ? formatDateTime(o.served_at) : '—'}</span>
        </div>
        <div className="bi-row">
          <span className="k">Thanh toán:</span>
          <strong>{o.paid_at ? formatDateTime(o.paid_at) : 'Chưa thanh toán'}</strong>
        </div>
        <div className="bi-row">
          <span className="k">Thời gian:</span>
          <span>{durationBetween(o.started_at, o.paid_at)}</span>
        </div>
        <div className="bi-row">
          <span className="k">NV nhận order:</span>
          <strong>{o.received_by_name ?? '—'}</strong>
        </div>
        <div className="bi-row">
          <span className="k">NV thanh toán:</span>
          <strong>{o.paid_by_name ?? '—'}</strong>
        </div>
        <div className="bi-row">
          <span className="k">Hình thức:</span>
          <span>{o.payment_method ? PAYMENT_LABEL[o.payment_method] : '—'}</span>
        </div>
        <div className="bi-row">
          <span className="k">Trạng thái:</span>
          <strong>
            {o.status === 'paid'
              ? 'ĐÃ THANH TOÁN'
              : o.status === 'cancelled'
                ? 'ĐÃ HUỶ'
                : 'CHƯA THANH TOÁN'}
          </strong>
        </div>
      </div>

      <table className="bill-table">
        <thead>
          <tr>
            <th style={{ width: 26 }}>SL</th>
            <th>Món ăn</th>
            <th className="num" style={{ width: 62 }}>
              Giá
            </th>
            <th className="num" style={{ width: 68 }}>
              Thành tiền
            </th>
          </tr>
        </thead>
        <tbody>
          {o.items.map((it) => (
            <tr key={it.id}>
              <td className="num">{it.quantity}</td>
              <td>
                <div>{it.dish_name}</div>
                {it.options?.length ? (
                  <div style={{ fontSize: 10.5, color: '#555' }}>
                    {it.options.map((x, i) => (
                      <span key={i}>
                        {x.group_name}: {x.option_name}
                        {x.price_delta ? ` (+${formatMoneyPlain(x.price_delta)})` : ''}
                        {i < it.options.length - 1 ? '; ' : ''}
                      </span>
                    ))}
                  </div>
                ) : null}
                {it.note ? <div style={{ fontSize: 10.5, color: '#777' }}>Ghi chú: {it.note}</div> : null}
              </td>
              <td className="num">{formatMoneyPlain(it.unit_price + it.options_total)}</td>
              <td className="num">{formatMoneyPlain(it.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {o.note ? (
        <div style={{ fontSize: 11, marginBottom: 8 }}>
          <strong>Ghi chú:</strong> {o.note}
        </div>
      ) : null}

      <div className="bill-totals">
        <div className="bill-total-row">
          <span>Tạm tính</span>
          <span>{formatMoneyPlain(o.subtotal)}</span>
        </div>
        {Number(o.discount) > 0 ? (
          <div className="bill-total-row">
            <span>
              Giảm trừ
              {o.discount_code ? ` (${o.discount_code}${o.discount_percent ? ` -${o.discount_percent}%` : ''})` : ''}
            </span>
            <span>−{formatMoneyPlain(o.discount)}</span>
          </div>
        ) : null}
        <div className="bill-total-row grand">
          <span>TỔNG CỘNG</span>
          <span>{formatMoneyPlain(o.total)} đ</span>
        </div>
      </div>

      <div className="bill-signs">
        <div style={{ flex: 1 }}>
          <div>Người thanh toán</div>
          <div className="s-line">(Ký, ghi rõ họ tên)</div>
        </div>
        <div style={{ flex: 1 }}>
          <div>NV thanh toán: {o.paid_by_name ?? '—'}</div>
          <div className="s-line">(Ký)</div>
        </div>
      </div>

      <div className="bill-foot">
        Cảm ơn quý khách và ủng hộ nhà hàng!
        <br />
        In lúc {formatDateTime(new Date().toISOString())}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Popup xem hóa đơn (đè lên giao diện chính, nền tối)
 * ------------------------------------------------------------------ */

interface BillModalProps {
  /** Mã đơn; null = đóng */
  orderNo: string | null;
  onClose: () => void;
  /** Dùng đơn đã có sẵn để mở tức thì không phải chờ tải lại */
  order?: Order | null;
}

export function BillModal({ orderNo, onClose, order: preset }: BillModalProps) {
  const state = useAsync<Order>(
    (signal) => api.get<Order>(`/staff/orders/${orderNo}`, { signal }),
    [orderNo],
    { enabled: !!orderNo && !preset },
  );

  const o = preset ?? state.data;

  useEffect(() => {
    if (!orderNo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [orderNo, onClose]);

  if (!orderNo) return null;

  return (
    // KHÔNG đặt `no-print` ở đây: chính `.bill-page` nằm trong backdrop này,
    // mà khi in `.no-print` bị `display:none !important` nên hoá đơn in ra
    // trang trắng. Phần cần ẩn khi in là thanh công cụ (đã có class no-print).
    <div className="bill-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bill-modal" role="dialog" aria-modal="true" aria-label="Xem hóa đơn">
        <div className="bill-modal-bar">
          <div className="grow">
            <strong>Hóa đơn {orderNo}</strong>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={onClose} type="button">
            ✕ Đóng
          </button>
          <button
            className="btn btn-sm"
            onClick={() => window.print()}
            type="button"
            disabled={!o}
          >
            🖨 In hóa đơn
          </button>
        </div>

        <div className="bill-modal-body">
          {!o ? (
            state.error ? (
              <div className="alert alert-error">{state.error}</div>
            ) : (
              <div className="loading-box">Đang tải hóa đơn...</div>
            )
          ) : (
            <BillSheet order={o} />
          )}
        </div>
      </div>
    </div>
  );
}
