import { useMemo, useState } from 'react';
import { AsyncBlock } from '../../components/PageParts';
import { api, tokenStore } from '../../lib/http';
import { formatMoney, formatTime } from '../../lib/format';
import { useAsync } from '../../hooks/useAsync';
import { useLiveStream } from '../../hooks/useLiveStream';
import { useStaffAuth } from '../../hooks/useStaffAuth';
import { ADMIN_SECTIONS, AppLayout, STAFF_SECTIONS } from '../../components/AppLayout';
import { BillModal } from '../../components/BillModal';
import { OrderItems, OrderTimeline, StatusBadge } from '../../components/OrderBits';
import { RealtimeClock } from '../../components/RealtimeClock';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import type { Branch, Order } from '../../types';

const VND = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

interface DiscountPreview {
  code: string;
  description: string | null;
  percent: number;
  subtotal: number;
  discount_amount: number;
  total: number;
}

/* ================================================================== *
 *  Màn hình thanh toán
 * ================================================================== */

export function StaffPayments() {
  const toast = useToast();
  const { user } = useStaffAuth();
  const isAdmin = user?.role === 'admin';

  const [branchFilter, setBranchFilter] = useState<'' | number>('');
  const branches = useAsync<Branch[]>(
    (signal) => api.get<Branch[]>('/staff/branches', { signal }),
    [],
    { enabled: isAdmin },
  );

  const qs = branchFilter === '' ? '' : `?branch_id=${branchFilter}`;
  const state = useAsync<Order[]>(
    (signal) => api.get<Order[]>(`/staff/orders/unpaid${qs}`, { signal }),
    [qs],
  );

  const [pay, setPay] = useState<Order | null>(null);
  const [discount, setDiscount] = useState('');
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<DiscountPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Order | null>(null);
  const [billNo, setBillNo] = useState<string | null>(null);

  useLiveStream(tokenStore.getStaffToken(), (e) => {
    if (e.type.startsWith('order.')) {
      state.reload();
      if (detail && (e as { orderNo?: string }).orderNo === detail.order_no) {
        api.get<Order>(`/staff/orders/${detail.order_no}`).then(setDetail).catch(() => undefined);
      }
    }
  });

  const rows = state.data ?? [];
  const totalMoney = useMemo(() => rows.reduce((s, o) => s + Number(o.total), 0), [rows]);

  const discountNum = Number(discount.replace(/\D/g, '')) || 0;
  // Ưu tiên mã giảm giá đã kiểm tra; nếu không có thì dùng giảm trừ tay
  const effectiveDiscount = preview ? preview.discount_amount : discountNum;
  const payable = preview ? preview.total : Math.max(0, Number(pay?.subtotal ?? 0) - discountNum);

  const openPay = (o: Order) => {
    setPay(o);
    setDiscount('');
    setCode('');
    setPreview(null);
  };

  const closePay = () => {
    setPay(null);
    setDiscount('');
    setCode('');
    setPreview(null);
  };

  /** Kiểm tra mã giảm giá với hệ thống trước khi thu tiền */
  const checkCode = async () => {
    if (!pay) return;
    const c = code.trim();
    if (!c) {
      setPreview(null);
      return;
    }
    setChecking(true);
    try {
      const res = await api.post<DiscountPreview>('/staff/discount-codes/preview', {
        orderNo: pay.order_no,
        code: c,
      });
      setPreview(res);
      setDiscount('');
      toast.success(`Áp dụng mã ${res.code}: giảm ${formatMoney(res.discount_amount)}.`);
    } catch (err) {
      setPreview(null);
      toast.error(err instanceof Error ? err.message : 'Mã giảm giá không hợp lệ.');
    } finally {
      setChecking(false);
    }
  };

  const doPay = async (method: 'cash' | 'transfer') => {
    if (!pay) return;
    setBusy(true);
    try {
      await api.post(`/staff/orders/${pay.order_no}/pay`, {
        method,
        discount: preview ? undefined : discountNum > 0 ? discountNum : undefined,
        discount_code: preview ? preview.code : undefined,
      });
      toast.success(`Đã xác nhận thanh toán ${formatMoney(payable)} cho bàn ${pay.table_code}.`);
      closePay();
      state.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Thanh toán thất bại.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppLayout
      role="staff"
      sections={isAdmin ? ADMIN_SECTIONS : STAFF_SECTIONS}
      title="Hóa đơn chưa thanh toán"
      onRefresh={state.reload}
      refreshing={state.loading}
      subtitle={`${rows.length} hóa đơn · Tổng ${formatMoney(totalMoney)}`}
      actions={
        isAdmin ? (
          <select
            className="input code-input"
            
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

      <AsyncBlock
        loading={state.loading}
        error={state.error}
        loadingText="Đang tải hóa đơn..."
        empty={rows.length === 0 ? (
          <div className="empty">
            <div className="icon">🎉</div>
            <div className="strong">Tất cả hóa đơn đã được thanh toán</div>
            <div className="small">Hóa đơn mới sẽ hiển thị ở đây</div>
          </div>
        ) : undefined}
      >
        <>
          <div className="s-stats">
            <div className="s-stat">
              <div className="lbl">Số hóa đơn chờ</div>
              <div className="val">{rows.length}</div>
            </div>
            <div className="s-stat accent">
              <div className="lbl">Tổng tiền phải thu</div>
              <div className="val">{VND.format(totalMoney)}đ</div>
            </div>
            <div className="s-stat blue">
              <div className="lbl">Đã phục vụ xong</div>
              <div className="val">{rows.filter((o) => o.status === 'served').length}</div>
            </div>
            <div className="s-stat green">
              <div className="lbl">Đang chuẩn bị</div>
              <div className="val">{rows.filter((o) => o.status === 'confirmed').length}</div>
            </div>
          </div>

          {rows.map((o) => (
            <div className="o-card" key={o.id}>
              <div className="o-card-head">
                <div className="stack">
                  <div className="o-card-title">
                    <span className="badge badge-brand">🪑 {o.table_name ?? '—'}</span>
                    {o.table_branch_name ? (
                      <span className="badge">🏢 {o.table_branch_name}</span>
                    ) : null}
                    <span className="mono small strong">{o.order_no}</span>
                    <StatusBadge status={o.status} />
                  </div>
                  <div className="tiny muted o-card-sub">
                    👤 {o.customer_name} · ☎ {o.customer_phone} · 🕐 {formatTime(o.started_at)} ·{' '}
                    <RealtimeClock from={o.started_at} label="" />
                  </div>
                </div>
                <div className="o-card-sum">
                  <div className="money">{formatMoney(o.total)}</div>
                  {Number(o.discount) > 0 ? (
                    <div className="cut">đã giảm {formatMoney(o.discount)}</div>
                  ) : null}
                </div>
              </div>

              <div className="o-card-body">
                <OrderItems order={o} compact />
                {o.received_by_name ? (
                  <div className="tiny muted mt-10">
                    🧑‍🍳 PV nhận order: <strong>{o.received_by_name}</strong>
                  </div>
                ) : null}
                {o.kitchen_received_by_name ? (
                  <div className="tiny muted mt-6">
                    🍳 Bếp nhận: <strong>{o.kitchen_received_by_name}</strong>
                  </div>
                ) : null}
              </div>

              <div className="o-card-foot">
                <button className="btn btn-ghost btn-sm" onClick={() => void api.get<Order>(`/staff/orders/${o.order_no}`).then(setDetail)} type="button">
                  Chi tiết
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setBillNo(o.order_no)} type="button">
                  🧾 Xem bill
                </button>
                <button className="btn btn-sm" onClick={() => openPay(o)} type="button">
                  💰 Thanh toán
                </button>
              </div>
            </div>
          ))}
        </>
      </AsyncBlock>

      {/* ---- Modal thanh toán ---- */}
      <Modal
        open={!!pay}
        title="Xác nhận thanh toán"
        onClose={closePay}
        footer={
          <>
            <button className="btn btn-secondary" onClick={closePay} disabled={busy} type="button">
              Huỷ
            </button>
            {/* Chuyển khoản: giữ nguyên dạng placeholder, luôn không bấm được
                cho tới khi backend bật (POST /pay với method=transfer đang trả 403) */}
            <button
              className="btn btn-info"
              disabled
              aria-disabled="true"
              title="Tính năng đang tạm để mờ"
              type="button"
            >
              🏦 Chuyển khoản (tạm thời để mờ)
            </button>
            <button className="btn btn-success" disabled={busy || discountNum > Number(pay?.subtotal ?? 0)} onClick={() => doPay('cash')} type="button">
              {busy && <span className="spinner" />} 💵 Đã thu tiền mặt
            </button>
          </>
        }
      >
        {pay ? (
          <>
            <div className="alert alert-info">
              Bàn <strong>{pay.table_name}</strong> · {pay.customer_name} · {pay.customer_phone}
              {pay.table_branch_name ? ` · 🏢 ${pay.table_branch_name}` : ''}
            </div>

            <div className="card" style={{ padding: 13, marginBottom: 15, maxHeight: 190, overflowY: 'auto' }}>
              <OrderItems order={pay} compact />
            </div>

            <div className="c-totals" style={{ marginBottom: 15 }}>
              <div className="c-totals-row">
                <span>Tạm tính</span>
                <span>{formatMoney(pay.subtotal)}</span>
              </div>

              {/* ---- Mã giảm giá do Admin tạo ---- */}
              <div className="field" style={{ margin: '0 0 8px' }}>
                <label htmlFor="code">
                  🎟️ Mã giảm giá <span className="hint">(khách đưa mã cho nhân viên)</span>
                </label>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    id="code"
                    className="input grow mono"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.toUpperCase());
                      setPreview(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void checkCode();
                      }
                    }}
                    placeholder="VD: GIAM10"
                    maxLength={40}
                  />
                  <button className="btn btn-secondary" onClick={() => void checkCode()} disabled={checking || !code.trim()} type="button">
                    {checking ? <span className="spinner" /> : 'Kiểm tra'}
                  </button>
                </div>
                {preview ? (
                  <div className="alert alert-ok" style={{ marginTop: 8, marginBottom: 0 }}>
                    ✅ Mã <strong>{preview.code}</strong> hợp lệ — giảm {preview.percent}% (
                    <strong>{formatMoney(preview.discount_amount)}</strong>)
                    {preview.description ? <div className="tiny">{preview.description}</div> : null}
                  </div>
                ) : null}
              </div>

              {/* ---- Giảm trừ thủ công ---- */}
              {!preview ? (
                <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
                  <div className="field grow" style={{ margin: 0 }}>
                    <label htmlFor="disc">Hoặc giảm trừ số tiền</label>
                    <input
                      id="disc"
                      className="input"
                      inputMode="numeric"
                      value={discount}
                      onChange={(e) => setDiscount(e.target.value.replace(/\D/g, '').slice(0, 12))}
                      placeholder="0"
                    />
                  </div>
                  <button className="btn btn-ghost btn-sm" style={{ marginBottom: 1 }} type="button" onClick={() => setDiscount('')}>
                    Xoá
                  </button>
                </div>
              ) : null}

              {discountNum > Number(pay.subtotal) ? (
                <div className="tiny danger-text">
                  Số tiền giảm không được vượt quá tạm tính.
                </div>
              ) : null}
              <div className="c-totals-row grand">
                <span>Khách phải trả</span>
                <span>{formatMoney(Math.max(0, payable))}</span>
              </div>
            </div>

            <div className="alert alert-warn" style={{ marginBottom: 0 }}>
              💵 Chỉ bấm <strong>"Đã thu tiền mặt"</strong> sau khi nhận đủ tiền của khách.
              <br />
              🏦 Thanh toán chuyển khoản đang tạm thời để mờ.
            </div>
          </>
        ) : null}
      </Modal>

      {/* ---- Modal chi tiết ---- */}
      <Modal open={!!detail} size="lg" title={detail?.order_no ?? ''} onClose={() => setDetail(null)}>
        {detail ? (
          <>
            <div className="tiny muted" style={{ marginBottom: 12 }}>
              🪑 {detail.table_name} · 👤 {detail.customer_name} · ☎ {detail.customer_phone}
              {detail.table_branch_name ? ` · 🏢 ${detail.table_branch_name}` : ''}
            </div>
            <OrderItems order={detail} />
            <h4 className="sub-head">Nhật ký</h4>
            <OrderTimeline order={detail} />
          </>
        ) : null}
      </Modal>

      {/* ---- Popup xem hóa đơn ---- */}
      <BillModal orderNo={billNo} onClose={() => setBillNo(null)} />
    </AppLayout>
  );
}