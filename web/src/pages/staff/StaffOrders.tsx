import { useState } from 'react';
import { api, tokenStore } from '../../lib/http';
import { formatMoney, formatTime, timeAgo } from '../../lib/format';
import { useAsync } from '../../hooks/useAsync';
import { useLiveStream } from '../../hooks/useLiveStream';
import { useStaffAuth } from '../../hooks/useStaffAuth';
import { ADMIN_SECTIONS, AppLayout, STAFF_SECTIONS } from '../../components/AppLayout';
import { BranchFilter } from '../../components/PageParts';
import { BillModal } from '../../components/BillModal';
import { OrderItems, OrderTimeline, StatusBadge } from '../../components/OrderBits';
import { RealtimeClock } from '../../components/RealtimeClock';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import type { Branch, Order } from '../../types';

/* ================================================================== *
 *  Danh sách order (chờ xác nhận · chưa chuyển bếp · bếp đã xong ·
 *  đơn chưa order · tất cả)
 * ================================================================== */

/** Nội dung hiển thị khi một tab không có đơn nào. */
const EMPTY_VIEW: Record<
  'pending' | 'waitKitchen' | 'kitchenDone' | 'draft' | 'all',
  { icon: string; strong: string; small: string }
> = {
  pending: {
    icon: '✅',
    strong: 'Không có đơn chờ xác nhận',
    small: 'Đơn của khách sẽ xuất hiện ở đây ngay khi khách gửi.',
  },
  waitKitchen: {
    icon: '🍳',
    strong: 'Không có đơn nào chờ chuyển bếp',
    small: 'Đơn đã nhận sẽ nằm ở đây cho tới khi bạn bấm “Chuyển qua bếp”.',
  },
  kitchenDone: {
    icon: '✅',
    strong: 'Bếp chưa làm xong đơn nào',
    small: 'Khi bếp nấu xong và trả lại, đơn sẽ hiện ở đây để bạn mang ra cho khách.',
  },
  draft: {
    icon: '🗂',
    strong: 'Không có đơn chưa order',
    small: 'Tất cả phiên khách đều đã gửi món hoặc đã được dọn.',
  },
  all: {
    icon: '📭',
    strong: 'Chưa có đơn nào',
    small: 'Đơn của khách sẽ xuất hiện ở đây ngay khi khách gửi.',
  },
};

export function StaffOrders() {
  const toast = useToast();
  const { user } = useStaffAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<'pending' | 'waitKitchen' | 'kitchenDone' | 'draft' | 'all'>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<Order | null>(null);
  const [rejecting, setRejecting] = useState<Order | null>(null);
  const [reason, setReason] = useState('');
  const [billNo, setBillNo] = useState<string | null>(null);
  const [deletingDraft, setDeletingDraft] = useState<Order | null>(null);

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
  // Đơn chưa gửi món (khách quét QR xong nhưng bỏ đi) — xem mục ĐƠN NHÁP bên dưới
  const drafts = useAsync<OrderList>(
    (signal) => api.get<OrderList>(`/staff/orders/drafts${qs}`, { signal }),
    [qs],
  );

  useLiveStream(tokenStore.getStaffToken(), (e) => {
    if (e.type.startsWith('order.')) {
      state.reload();
      all.reload();
      drafts.reload();
      if (detail && (e as { orderNo?: string }).orderNo === detail.order_no) {
        api.get<Order>(`/staff/orders/${detail.order_no}`).then(setDetail).catch(() => undefined);
      }
    }
  });

  const act = async (
    order: Order,
    action: 'confirm' | 'sendKitchen' | 'serve' | 'unserve' | 'reject',
    msg: string,
  ) => {
    setBusy(order.order_no + action);
    try {
      if (action === 'confirm') {
        await api.post(`/staff/orders/${order.order_no}/confirm`);
      } else if (action === 'sendKitchen') {
        await api.post(`/staff/orders/${order.order_no}/send-kitchen`);
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

  /** Nút làm mới — nạp lại cả 3 danh sách + đơn đang mở chi tiết. */
  const refreshAll = () => {
    state.reload();
    all.reload();
    drafts.reload();
    if (detail) {
      api.get<Order>(`/staff/orders/${detail.order_no}`).then(setDetail).catch(() => undefined);
    }
  };

  const pendingList = (state.data?.rows ?? []).filter((o) => o.status === 'pending');
  const draftList = drafts.data?.rows ?? [];
  // Đã nhận order nhưng chưa bấm chuyển qua bếp (PV bàn cần xử lý).
  const waitKitchenList = (all.data?.rows ?? []).filter((o) => o.status === 'confirmed');
  // Bếp đã nấu xong và trả lại, chờ PV bàn mang ra cho khách.
  const kitchenDoneList = (all.data?.rows ?? []).filter((o) => o.status === 'ready_to_serve');
  const rows =
    tab === 'pending'
      ? pendingList
      : tab === 'waitKitchen'
        ? waitKitchenList
        : tab === 'kitchenDone'
          ? kitchenDoneList
          : tab === 'draft'
            ? draftList
            : (all.data?.rows ?? []);

  return (
    <AppLayout
      role="staff"
      sections={isAdmin ? ADMIN_SECTIONS : STAFF_SECTIONS}
      title="Danh sách Order"
      subtitle={`${pendingList.length} đơn chờ xác nhận · ${waitKitchenList.length} chưa chuyển bếp · ${kitchenDoneList.length} bếp đã làm xong${draftList.length ? ` · ${draftList.length} đơn chưa order` : ''}`}
      actions={
        isAdmin ? (
          <BranchFilter branchFilter={branchFilter} onChange={setBranchFilter} branches={branches.data ?? []} />
        ) : user && user.branch_name ? (
          <span className="badge badge-info">🏢 {user.branch_name}</span>
        ) : null
      }
      onRefresh={refreshAll}
      refreshing={state.loading || all.loading || drafts.loading}
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
        <button
          className={`s-tab ${tab === 'waitKitchen' ? 'active' : ''}`}
          onClick={() => setTab('waitKitchen')}
          title="Đơn đã nhận nhưng chưa bấm chuyển qua bếp. Bấm vào để xem và chuyển bếp."
          type="button"
        >
          🍳 Chưa chuyển bếp {waitKitchenList.length > 0 ? `(${waitKitchenList.length})` : ''}
        </button>
        <button
          className={`s-tab ${tab === 'kitchenDone' ? 'active' : ''}`}
          onClick={() => setTab('kitchenDone')}
          title="Bếp đã nấu xong và trả lại, chờ phục vụ bàn mang ra cho khách."
          type="button"
        >
          ✅ Bếp đã làm xong {kitchenDoneList.length > 0 ? `(${kitchenDoneList.length})` : ''}
        </button>
        <button
          className={`s-tab ${tab === 'draft' ? 'active' : ''}`}
          onClick={() => setTab('draft')}
          title="Khách đã quét QR + nhập tên nhưng chưa gửi món. Xoá ở đây để dọn, hệ thống cũng tự xoá sau 24h."
          type="button"
        >
          🗂 Đơn chưa order {draftList.length > 0 ? `(${draftList.length})` : ''}
        </button>
        <button className={`s-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')} type="button">
          Tất cả đơn
        </button>
      </div>

      {tab === 'draft' ? (
        <div className="alert alert-info mb-14">
          ℹ️ Đây là các phiên khách <strong>đã quét QR và nhập tên/SĐT nhưng chưa gửi món</strong> (quét nhầm, điện
          thoại hết pin, khách bỏ đi...). Bạn có thể <strong>xoá</strong> để dọn sạch; hệ thống cũng tự động xoá các
          đơn này sau <strong>24 giờ</strong> kể từ lúc tạo.
        </div>
      ) : null}

      {(tab === 'pending' ? state.loading : tab === 'draft' ? drafts.loading : all.loading) ? (
        <div className="loading-box">Đang tải danh sách order...</div>
      ) : (
        <>
          {state.error || all.error || drafts.error ? (
            <div className="alert alert-error">{state.error ?? all.error ?? drafts.error}</div>
          ) : null}

          {rows.length === 0 ? (
            <div className="empty">
              <div className="icon">{EMPTY_VIEW[tab].icon}</div>
              <div className="strong">{EMPTY_VIEW[tab].strong}</div>
              <div className="small">{EMPTY_VIEW[tab].small}</div>
            </div>
          ) : (
            rows.map((o) => (
              <div className="o-card" key={o.id}>
                <div className="o-card-head">
                  <div className="stack">
                    <div>
                      <div className="o-card-title">
                        <span className="badge badge-brand">🪑 {o.table_name ?? '—'}</span>
                        {o.table_branch_name ? <span className="badge">🏢 {o.table_branch_name}</span> : null}
                        <span className="mono small strong">{o.order_no}</span>
                      </div>
                      <div className="tiny muted o-card-sub">
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
                        <RealtimeClock from={o.started_at} label="" />
                      </div>
                      {o.received_by_name ? (
                        <div className="o-meta-item">
                          <span className="k">PV nhận:</span>
                          <strong>{o.received_by_name}</strong>
                        </div>
                      ) : null}
                      {o.kitchen_received_by_name ? (
                        <div className="o-meta-item">
                          <span className="k">Bếp nhận:</span>
                          <strong>{o.kitchen_received_by_name}</strong>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <StatusBadge status={o.status} />
                </div>

                <div className="o-card-body">
                  <OrderItems order={o} />
                  {o.note ? (
                    <div className="alert alert-warn note-inline">
                      📝 Ghi chú: {o.note}
                    </div>
                  ) : null}
                  <div className="row-between" style={{ marginTop: 12, paddingTop: 11, borderTop: '1px solid var(--line)' }}>
                    <span className="muted small">
                      {o.items.reduce((s, i) => s + i.quantity, 0)} món
                    </span>
                    <span className="total-label">
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
                      <button className="btn btn-sm btn-danger-soft" onClick={() => setRejecting(o)} type="button">
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

                  {/* ③ Đã nhận order: gửi qua bếp, hoặc tự phục vụ nếu không qua bếp */}
                  {o.status === 'confirmed' ? (
                    <>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={busy === o.order_no + 'sendKitchen'}
                        onClick={() => act(o, 'sendKitchen', `Đã chuyển đơn ${o.order_no} qua bếp`)}
                        title="Chuyển đơn sang phục vụ bếp nấu"
                        type="button"
                      >
                        {busy === o.order_no + 'sendKitchen' ? <span className="spinner" /> : '🍳'} Chuyển qua bếp
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={busy === o.order_no + 'serve'}
                        onClick={() => act(o, 'serve', 'Đã đánh dấu phục vụ xong')}
                        title="Dùng khi món không cần qua bếp (mì, phở bêng, nước)"
                        type="button"
                      >
                        {busy === o.order_no + 'serve' ? <span className="spinner" /> : '🍽'} Không qua bếp — phục vụ luôn
                      </button>
                    </>
                  ) : null}

                  {/* ⑦ Bếp đã làm xong, trả lại phục vụ bàn */}
                  {o.status === 'ready_to_serve' ? (
                    <button
                      className="btn btn-success btn-sm"
                      disabled={busy === o.order_no + 'serve'}
                      onClick={() => act(o, 'serve', `Đã nhận món từ bếp cho bàn ${o.table_name}`)}
                      title="Bếp đã làm xong và trả lại"
                      type="button"
                    >
                      {busy === o.order_no + 'serve' ? <span className="spinner" /> : '✓'} Nhận từ bếp — phục vụ khách
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

                  {o.status === 'draft' ? (
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={busy === o.order_no + 'draft'}
                      onClick={() => setDeletingDraft(o)}
                      type="button"
                    >
                      {busy === o.order_no + 'draft' ? <span className="spinner" /> : '🗑'} Xoá đơn chưa order
                    </button>
                  ) : null}
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
                <div className="tiny muted mt-3">
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
              <div className="row mb-14">
                <StatusBadge status={detail.status} />
                <span className="tiny muted">Cập nhật {timeAgo(detail.updated_at)}</span>
              </div>
              {/* Vòng bếp: ai gửi qua, ai nhận, ai làm xong */}
              {detail.sent_to_kitchen_at || detail.kitchen_received_by_name || detail.kitchen_done_by_name ? (
                <div className="alert alert-info" style={{ marginBottom: 12 }}>
                  🍳{' '}
                  {detail.sent_to_kitchen_at
                    ? `Chuyển bếp lúc ${formatTime(detail.sent_to_kitchen_at)}${
                        detail.sent_to_kitchen_by_name ? ` (${detail.sent_to_kitchen_by_name})` : ''
                      }.`
                    : null}{' '}
                  {detail.kitchen_received_by_name
                    ? `Bếp nhận: ${detail.kitchen_received_by_name}.`
                    : 'Bếp chưa nhận.'}{' '}
                  {detail.kitchen_done_by_name ? `Đã nấu xong (${detail.kitchen_done_by_name}).` : null}
                </div>
              ) : null}
              <OrderItems order={detail} />
              <h4 className="sub-head">Nhật ký</h4>
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
              {detail.status === 'confirmed' ? (
                <button
                  className="btn btn-primary"
                  onClick={() => act(detail, 'sendKitchen', `Đã chuyển đơn ${detail.order_no} qua bếp`)}
                  type="button"
                >
                  🍳 Chuyển qua bếp
                </button>
              ) : null}
              {detail.status === 'ready_to_serve' ? (
                <button
                  className="btn btn-success"
                  onClick={() => act(detail, 'serve', 'Đã nhận món từ bếp, phục vụ khách')}
                  type="button"
                >
                  ✓ Nhận từ bếp — phục vụ khách
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

      {/* Xoá đơn chưa gửi món (draft) */}
      <ConfirmDialog
        open={!!deletingDraft}
        danger
        title="Xoá đơn chưa order?"
        confirmLabel="🗑 Xoá đơn"
        busy={busy === deletingDraft?.order_no + 'draft'}
        message={
          <div>
            <p>
              Xoá phiên <strong className="mono">{deletingDraft?.order_no}</strong> của bàn{' '}
              <strong>{deletingDraft?.table_name}</strong> — {deletingDraft?.customer_name} (
              {deletingDraft?.customer_phone})?
            </p>
            <p className="small muted mt-8">
              Khách chưa gửi món nên xoá không ảnh hưởng đơn thật. Nếu khách đang mở trình duyệt trên bàn, họ sẽ
              được tạo phiên mới khi tải lại trang. (Nếu không xoá, hệ thống cũng tự dọn sau 24h.)
            </p>
          </div>
        }
        onCancel={() => setDeletingDraft(null)}
        onConfirm={async () => {
          if (!deletingDraft) return;
          setBusy(deletingDraft.order_no + 'draft');
          try {
            await api.del(`/staff/orders/${deletingDraft.order_no}/draft`);
            toast.success('Đã xoá đơn chưa order.');
            drafts.reload();
            all.reload();
            setDeletingDraft(null);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Không xoá được.');
          } finally {
            setBusy(null);
          }
        }}
      />

      {/* ---- Popup xem hóa đơn ---- */}
      <BillModal orderNo={billNo} onClose={() => setBillNo(null)} />
    </AppLayout>
  );
}
