import { useState } from 'react';
import { api, durationBetween, formatMoney, formatTime, timeAgo, tokenStore, useAsync, useLiveStream, useStaffAuth } from '../../api';
import { ADMIN_SECTIONS, AppLayout, STAFF_SECTIONS } from '../../components/AppLayout';
import { BillModal } from '../../components/BillModal';
import { OrderItems, OrderTimeline, StatusBadge } from '../../components/OrderBits';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import type { Branch, Order } from '../../types';

/* ================================================================== *
 *  Danh sách order (chờ xác nhận + toàn bộ)
 * ================================================================== */

export function StaffOrders() {
  const toast = useToast();
  const { user } = useStaffAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<Order | null>(null);
  const [rejecting, setRejecting] = useState<Order | null>(null);
  const [reason, setReason] = useState('');
  const [billNo, setBillNo] = useState<string | null>(null);

  const [branchFilter, setBranchFilter] = useState<'' | number>('');
  const branches = useAsync<Branch[]>(
    (signal) => api.get<Branch[]>('/staff/branches', { signal }),
    [],
    { enabled: isAdmin },
  );

  const qs = branchFilter === '' ? '' : `&branch_id=${branchFilter}`;
  type OrderList = { rows: Order[]; total: number };
  const state = useAsync<OrderList>(
    (signal) => api.get<OrderList>(`/staff/orders?status=pending&limit=200${qs}`, { signal }),
    [qs],
  );
  const all = useAsync<OrderList>(
    (signal) => api.get<OrderList>(`/staff/orders?limit=200${qs}`, { signal }),
    [qs],
  );

  useLiveStream(tokenStore.getStaffToken(), (e) => {
    if (e.type.startsWith('order.')) {
      state.reload();
      all.reload();
      if (detail && (e as { orderNo?: string }).orderNo === detail.order_no) {
        api.get<Order>(`/staff/orders/${detail.order_no}`).then(setDetail).catch(() => undefined);
      }
    }
  });

  const act = async (order: Order, action: 'confirm' | 'serve' | 'unserve' | 'reject', msg: string, body?: unknown) => {
    setBusy(order.order_no + action);
    try {
      if (action === 'confirm') {
        await api.post(`/staff/orders/${order.order_no}/confirm`);
      } else if (action === 'serve') {
        await api.post(`/staff/orders/${order.order_no}/serve`, { served: true });
      } else if (action === 'unserve') {
        await api.post(`/staff/orders/${order.order_no}/serve`, { served: false });
      } else {
        await api.post(`/staff/orders/${order.order_no}/reject`, { reason });
      }
      toast.success(msg);
      state.reload();
      all.reload();
      setRejecting(null);
      setReason('');
      if (detail?.order_no === order.order_no) setDetail(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Thao tác thất bại.');
    } finally {
      setBusy(null);
    }
  };

  const pendingList = (state.data?.rows ?? []).filter((o) => o.status === 'pending');
  const rows = tab === 'pending' ? pendingList : (all.data?.rows ?? []);

  return (
    <AppLayout
      role="staff"
      sections={isAdmin ? ADMIN_SECTIONS : STAFF_SECTIONS}
      title="Danh sách Order"
      subtitle={`${pendingList.length} đơn đang chờ xác nhận`}
      actions={
        isAdmin ? (
          <select
            className="input"
            style={{ width: 200, padding: '7px 10px' }}
            value={branchFilter === '' ? '' : String(branchFilter)}
            onChange={(e) => setBranchFilter(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">🏢 Tất cả cơ sở</option>
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                🏢 {b.name}
              </option>
            ))}
          </select>
        ) : user && user.branch_name ? (
          <span className="badge badge-info">🏢 {user.branch_name}</span>
        ) : null
      }
    >
      {user && user.role === 'staff' && user.branch_id === null ? (
        <div className="alert alert-warn">
          ⚠️ Tài khoản của bạn <strong>chưa được gán cơ sở</strong> nên không thấy đơn nào.
          Vui lòng liên hệ Admin gán cơ sở trong trang <em>Quản lý tài khoản</em>.
        </div>
      ) : null}

      <div className="s-tabs">
        <button className={`s-tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')} type="button">
          🕐 Chờ xác nhận {pendingList.length > 0 ? `(${pendingList.length})` : ''}
        </button>
        <button className={`s-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')} type="button">
          Tất cả đơn
        </button>
      </div>

      {(tab === 'pending' ? state.loading : all.loading) ? (
        <div className="loading-box">Đang tải danh sách order...</div>
      ) : (
        <>
          {state.error || all.error ? <div className="alert alert-error">{state.error ?? all.error}</div> : null}

          {rows.length === 0 ? (
            <div className="empty">
              <div className="icon">{tab === 'pending' ? '✅' : '📭'}</div>
              <div className="strong">{tab === 'pending' ? 'Không có đơn chờ xác nhận' : 'Chưa có đơn nào'}</div>
              <div className="small">Đơn của khách sẽ xuất hiện ở đây ngay khi khách gửi</div>
            </div>
          ) : (
            rows.map((o) => (
              <div className="o-card" key={o.id}>
                <div className="o-card-head">
                  <div className="row wrap" style={{ gap: 14 }}>
                    <div>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="badge badge-brand">🪑 {o.table_name ?? '—'}</span>
                        {o.table_branch_name ? <span className="badge">🏢 {o.table_branch_name}</span> : null}
                        <span className="mono small strong">{o.order_no}</span>
                      </div>
                      <div className="tiny muted" style={{ marginTop: 3 }}>
                        👤 {o.customer_name} · ☎ {o.customer_phone}
                      </div>
                    </div>
                    <div className="o-meta">
                      <div className="o-meta-item">
                        <span className="k">Bắt đầu:</span>
                        <strong>{formatTime(o.started_at)}</strong>
                      </div>
                      <div className="o-meta-item">
                        <span className="k">Chờ:</span>
                        <strong className={o.status === 'pending' ? '' : 'muted'} style={o.status === 'pending' ? { color: 'var(--warn)' } : undefined}>
                          {durationBetween(o.started_at, null)}
                        </strong>
                      </div>
                      {o.received_by_name ? (
                        <div className="o-meta-item">
                          <span className="k">NV nhận:</span>
                          <strong>{o.received_by_name}</strong>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <StatusBadge status={o.status} />
                </div>

                <div className="o-card-body">
                  <OrderItems order={o} />
                  {o.note ? (
                    <div className="alert alert-warn" style={{ marginTop: 12, marginBottom: 0 }}>
                      📝 Ghi chú: {o.note}
                    </div>
                  ) : null}
                  <div className="row-between" style={{ marginTop: 12, paddingTop: 11, borderTop: '1px solid var(--line)' }}>
                    <span className="muted small">
                      {o.items.reduce((s, i) => s + i.quantity, 0)} món
                    </span>
                    <span style={{ fontSize: 19, fontWeight: 800, color: 'var(--brand-dark)' }}>
                      {formatMoney(o.total)}
                    </span>
                  </div>
                </div>

                <div className="o-card-foot">
                  <button className="btn btn-ghost btn-sm" onClick={() => void api.get<Order>(`/staff/orders/${o.order_no}`).then(setDetail)} type="button">
                    Chi tiết
                  </button>

                  {o.status === 'pending' ? (
                    <>
                      <button className="btn btn-ghost btn-sm btn-danger" style={{ background: 'var(--danger-bg)', color: 'var(--danger)', borderColor: 'transparent' }} onClick={() => setRejecting(o)} type="button">
                        Huỷ đơn
                      </button>
                      <button
                        className="btn btn-success btn-sm"
                        disabled={busy === o.order_no + 'confirm'}
                        onClick={() => act(o, 'confirm', `Đã nhận order ${o.order_no}`)}
                        type="button"
                      >
                        {busy === o.order_no + 'confirm' ? <span className="spinner" /> : '✓'} Xác nhận nhận order
                      </button>
                    </>
                  ) : null}

                  {o.status === 'confirmed' ? (
                    <button className="btn btn-info btn-sm" disabled={busy === o.order_no + 'serve'} onClick={() => act(o, 'serve', 'Đã đánh dấu phục vụ xong')} type="button">
                      {busy === o.order_no + 'serve' ? <span className="spinner" /> : '🍽'} Đã phục vụ xong
                    </button>
                  ) : null}

                  {o.status === 'served' ? (
                    <button className="btn btn-secondary btn-sm" disabled={busy === o.order_no + 'unserve'} onClick={() => act(o, 'unserve', 'Đã mở lại đơn')} type="button">
                      Mở lại
                    </button>
                  ) : null}

                  <button className="btn btn-secondary btn-sm" onClick={() => setBillNo(o.order_no)} type="button">
                    🧾 Xem bill
                  </button>
                </div>
              </div>
            ))
          )}
        </>
      )}

      {/* Modal chi tiết + nhật ký */}
      {detail ? (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal modal-lg" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ fontSize: 16 }} className="mono">{detail.order_no}</h3>
                <div className="tiny muted" style={{ marginTop: 3 }}>
                  🪑 {detail.table_name}
                  {detail.table_branch_name ? ` · 🏢 ${detail.table_branch_name}` : ''} · 👤 {detail.customer_name} · ☎{' '}
                  {detail.customer_phone}
                </div>
              </div>
              <button className="modal-close" onClick={() => setDetail(null)} aria-label="Đóng" type="button">
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="row" style={{ marginBottom: 14 }}>
                <StatusBadge status={detail.status} />
                <span className="tiny muted">Cập nhật {timeAgo(detail.updated_at)}</span>
              </div>
              <OrderItems order={detail} />
              <h4 style={{ fontSize: 14, margin: '18px 0 10px' }}>Nhật ký</h4>
              <OrderTimeline order={detail} />
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDetail(null)} type="button">
                Đóng
              </button>
              {detail.status === 'pending' ? (
                <button className="btn btn-success" onClick={() => act(detail, 'confirm', 'Đã nhận order')} type="button">
                  Xác nhận nhận order
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Huỷ đơn */}
      <ConfirmDialog
        open={!!rejecting}
        danger
        title="Huỷ đơn"
        confirmLabel="Huỷ đơn"
        busy={busy === rejecting?.order_no + 'reject'}
        message={
          <div>
            <p>
              Huỷ đơn <strong className="mono">{rejecting?.order_no}</strong> của bàn{' '}
              <strong>{rejecting?.table_name}</strong>?
            </p>
            <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
              <label htmlFor="rsn">Lý do (khách sẽ thấy)</label>
              <textarea
                id="rsn"
                className="textarea"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="VD: Món đã hết, nhà hàng hết nguyên liệu..."
                maxLength={300}
              />
            </div>
          </div>
        }
        onCancel={() => {
          setRejecting(null);
          setReason('');
        }}
        onConfirm={() => rejecting && act(rejecting, 'reject', 'Đã huỷ đơn')}
      />

      {/* ---- Popup xem hóa đơn ---- */}
      <BillModal orderNo={billNo} onClose={() => setBillNo(null)} />
    </AppLayout>
  );
}
