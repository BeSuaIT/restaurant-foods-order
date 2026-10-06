import { useState } from 'react';
import { AsyncBlock } from '../../components/PageParts';
import { api } from '../../lib/http';
import { durationBetween, formatDateTime, formatMoney } from '../../lib/format';
import { useAsync } from '../../hooks/useAsync';
import { ADMIN_SECTIONS, AppLayout } from '../../components/AppLayout';
import { BillModal } from '../../components/BillModal';
import { OrderItems, OrderTimeline, StatusBadge } from '../../components/OrderBits';
import { Modal } from '../../components/Modal';
import type { Branch, Order, OrderStatus } from '../../types';

interface HistoryRow extends Order {
  item_count: number;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'pending', label: 'Chờ xác nhận' },
  { value: 'confirmed', label: 'Đã xác nhận' },
  { value: 'served', label: 'Đã phục vụ' },
  { value: 'paid', label: 'Đã thanh toán' },
  { value: 'cancelled', label: 'Đã huỷ' },
];

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/**
 * LỊCH SỬ ORDER — chỉ Admin.
 * Lưu: khách hàng (tên + SĐT), giờ bắt đầu order, giờ thanh toán xong,
 * tên NV nhận order và tên NV thanh toán.
 */
export function AdminHistory() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(today());
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<Order | null>(null);
  const [billNo, setBillNo] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<'' | number>('');
  const limit = 30;

  const branches = useAsync<Branch[]>((signal) => api.get<Branch[]>('/admin/branches', { signal }), []);

  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(page * limit),
    q,
    from: `${from}T00:00:00`,
    to: `${to}T23:59:59`,
    ...(status ? { status } : {}),
    ...(branchFilter !== '' ? { branch_id: String(branchFilter) } : {}),
  });

  const state = useAsync<{ rows: HistoryRow[]; total: number }>(
    (signal) => api.get<{ rows: HistoryRow[]; total: number }>(`/admin/order-history?${query}`, { signal }),
    [status, q, from, to, page, branchFilter],
  );

  const rows = state.data?.rows ?? [];
  const total = state.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));

  const sum = rows.reduce((s, o) => s + Number(o.total), 0);
  const paidCount = rows.filter((o) => o.status === 'paid').length;

  const openDetail = (o: HistoryRow) => {
    api
      .get<Order>(`/staff/orders/${o.order_no}`)
      .then(setDetail)
      .catch(() => setDetail(o));
  };

  const exportCsv = () => {
    const header = [
      'Mã đơn',
      'Bàn',
      'Cơ sở',
      'Khu vực',
      'Khách hàng',
      'Số điện thoại',
      'Trạng thái',
      'Số món',
      'Tạm tính',
      'Mã giảm giá',
      '% giảm',
      'Giảm trừ',
      'Tổng tiền',
      'Hình thức',
      'Bắt đầu order',
      'NV nhận order',
      'Thời gian nhận',
      'Phục vụ xong',
      'Thanh toán lúc',
      'NV thanh toán',
    ];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const lines = rows.map((o) =>
      [
        o.order_no,
        o.table_name ?? '',
        o.table_branch_name ?? '',
        o.table_area ?? '',
        o.customer_name,
        o.customer_phone,
        o.status,
        o.item_count,
        o.subtotal,
        o.discount_code ?? '',
        o.discount_percent ?? 0,
        o.discount,
        o.total,
        o.payment_method === 'cash' ? 'Tiền mặt' : o.payment_method === 'transfer' ? 'Chuyển khoản' : '',
        formatDateTime(o.started_at),
        o.received_by_name ?? '',
        formatDateTime(o.confirmed_at),
        formatDateTime(o.served_at),
        formatDateTime(o.paid_at),
        o.paid_by_name ?? '',
      ]
        .map(esc)
        .join(','),
    );

    // BOM để Excel đọc đúng tiếng Việt có dấu
    const csv = '﻿' + [header.map(esc).join(','), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lich-su-order_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout
      role="admin"
      sections={ADMIN_SECTIONS}
      title="Lịch sử order"
      subtitle={`${total} đơn trong khoảng ${from} → ${to}`}
      actions={
        <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={rows.length === 0} type="button">
          ⬇ Xuất CSV
        </button>
      }
      onRefresh={state.reload}
      refreshing={state.loading}
    >
      <div className="s-filters">
        <div className="field">
          <label htmlFor="hf">Từ ngày</label>
          <input id="hf" className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
        </div>
        <div className="field">
          <label htmlFor="ht">Đến ngày</label>
          <input id="ht" className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
        </div>
        <div className="field">
          <label htmlFor="hs">Trạng thái</label>
          <select id="hs" className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="hb">Cơ sở</label>
          <select
            id="hb"
            className="select"
            value={branchFilter === '' ? '' : String(branchFilter)}
            onChange={(e) => { setBranchFilter(e.target.value === '' ? '' : Number(e.target.value)); setPage(0); }}
          >
            <option value="">Tất cả cơ sở</option>
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field grow history-search">
          <label htmlFor="hq">Tìm kiếm</label>
          <input
            id="hq"
            className="input"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
            placeholder="Mã đơn, tên, SĐT…"
          />
        </div>
      </div>

      <div className="s-stats">
        <div className="s-stat">
          <div className="lbl">Tổng đơn</div>
          <div className="val">{total}</div>
        </div>
        <div className="s-stat green">
          <div className="lbl">Đã thanh toán (trang này)</div>
          <div className="val">{paidCount}</div>
        </div>
        <div className="s-stat accent">
          <div className="lbl">Tổng tiền (trang này)</div>
          <div className="val">{formatMoney(sum)}</div>
        </div>
      </div>

      <AsyncBlock
        loading={state.loading}
        error={state.error}
        loadingText="Đang tải lịch sử..."
        empty={rows.length === 0 ? (
          <div className="empty">
            <div className="icon">🧾</div>
            <div>Không có đơn nào trong khoảng thời gian này</div>
          </div>
        ) : undefined}
      >
        <>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Mã đơn</th>
                  <th>Bàn</th>
                  <th>Cơ sở</th>
                  <th>Khách hàng</th>
                  <th>Trạng thái</th>
                  <th className="right">Món</th>
                  <th className="right">Tổng</th>
                  <th>Bắt đầu order</th>
                  <th>Thanh toán</th>
                  <th>NV nhận</th>
                  <th>NV thu tiền</th>
                  <th className="right"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td className="mono tiny">{o.order_no}</td>
                    <td className="nowrap">
                      <strong>{o.table_code ?? '—'}</strong>
                      {o.table_area ? <div className="tiny muted">{o.table_area}</div> : null}
                    </td>
                    <td className="tiny nowrap">{o.table_branch_name ?? <span className="muted">—</span>}</td>
                    <td className="nowrap">
                      <div className="small strong">{o.customer_name}</div>
                      <div className="tiny muted">{o.customer_phone}</div>
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="right">{o.item_count}</td>
                    <td className="right strong nowrap">
                      {formatMoney(o.total)}
                      {Number(o.discount) > 0 ? (
                        <div className="tiny danger-text">
                          {o.discount_code ? `${o.discount_code} · ` : ''}-{formatMoney(o.discount)}
                        </div>
                      ) : null}
                    </td>
                    <td className="tiny nowrap">
                      {formatDateTime(o.started_at)}
                      <div className="muted">⏱ {durationBetween(o.started_at, o.paid_at)}</div>
                    </td>
                    <td className="tiny nowrap">
                      {o.paid_at ? (
                        <>
                          {formatDateTime(o.paid_at)}
                          <div className="muted">
                            {o.payment_method === 'cash' ? 'Tiền mặt' : o.payment_method === 'transfer' ? 'Chuyển khoản' : ''}
                          </div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="tiny nowrap">{o.received_by_name ?? <span className="muted">-</span>}</td>
                    <td className="tiny nowrap">{o.paid_by_name ?? <span className="muted">-</span>}</td>
                    <td className="right">
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => openDetail(o)} type="button">
                          Chi tiết
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setBillNo(o.order_no)} type="button">
                          🧾
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <span className="small muted">
              Trang {page + 1} / {pages} · hiển thị {rows.length} / {total} đơn
            </span>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} type="button">
                ← Trước
              </button>
              <button className="btn btn-secondary btn-sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} type="button">
                Sau →
              </button>
            </div>
          </div>
        </>
      </AsyncBlock>

      {/* ---- Chi tiết đơn ---- */}
      <Modal open={!!detail} size="lg" title={detail?.order_no ?? ''} onClose={() => setDetail(null)}>
        {detail ? (
          <>
            <div className="row wrap" style={{ gap: 8, marginBottom: 13 }}>
              <StatusBadge status={detail.status as OrderStatus} />
              <span className="badge">🪑 {detail.table_name}</span>
              {detail.table_branch_name ? <span className="badge">🏢 {detail.table_branch_name}</span> : null}
              <span className="badge">👤 {detail.customer_name}</span>
              <span className="badge">☎ {detail.customer_phone}</span>
            </div>

            <div className="o-meta mb-14">
              <div className="o-meta-item">
                <span className="k">Bắt đầu order:</span>
                <strong>{formatDateTime(detail.started_at)}</strong>
              </div>
              <div className="o-meta-item">
                <span className="k">NV nhận order:</span>
                <strong>{detail.received_by_name ?? '—'}</strong>
              </div>
              <div className="o-meta-item">
                <span className="k">Thanh toán lúc:</span>
                <strong>{detail.paid_at ? formatDateTime(detail.paid_at) : '—'}</strong>
              </div>
              <div className="o-meta-item">
                <span className="k">NV thanh toán:</span>
                <strong>{detail.paid_by_name ?? '—'}</strong>
              </div>
              <div className="o-meta-item">
                <span className="k">Thời gian:</span>
                <strong>{durationBetween(detail.started_at, detail.paid_at)}</strong>
              </div>
            </div>

            <OrderItems order={detail} />

            <div className="row-between" style={{ marginTop: 14, paddingTop: 12, borderTop: '2px solid var(--line)' }}>
              <div>
                <strong style={{ fontSize: 16 }}>Tổng cộng</strong>
                {Number(detail.discount) > 0 ? (
                  <div className="tiny danger-text">
                    Tạm tính {formatMoney(detail.subtotal)} · giảm{' '}
                    {detail.discount_code ? `${detail.discount_code} ` : ''}
                    −{formatMoney(detail.discount)}
                  </div>
                ) : null}
              </div>
              <strong style={{ fontSize: 22, color: 'var(--brand-dark)' }}>{formatMoney(detail.total)}</strong>
            </div>

            <h4 className="sub-head">Nhật ký đầy đủ</h4>
            <OrderTimeline order={detail} />

            <div className="row" style={{ gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  const no = detail.order_no;
                  setDetail(null);
                  setBillNo(no);
                }}
                type="button"
              >
                🧾 Xem &amp; in bill
              </button>
            </div>
          </>
        ) : null}
      </Modal>

      {/* ---- Popup xem hóa đơn ---- */}
      <BillModal orderNo={billNo} onClose={() => setBillNo(null)} />
    </AppLayout>
  );
}
