import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, tokenStore } from '../../lib/http';
import { formatTime } from '../../lib/format';
import { useAsync } from '../../hooks/useAsync';
import { useLiveStream } from '../../hooks/useLiveStream';
import { useStaffAuth } from '../../hooks/useStaffAuth';
import { AppLayout, KITCHEN_SECTIONS } from '../../components/AppLayout';
import { AsyncBlock } from '../../components/PageParts';
import { RealtimeClock } from '../../components/RealtimeClock';
import { useToast } from '../../components/Toast';
import type { Order, OrderItem } from '../../types';

/* ================================================================== *
 *  BẢNG BẾP — màn duy nhất của phục vụ bếp
 *
 *  Chia 2 cột:
 *    • CHỜ BẾP NHẬN  đơn phục vụ bàn vừa chuyển qua (③)
 *    • ĐANG LÀM     bếp đã nhận, tick từng món xong (④)
 *
 *  Bếp không thấy giá tiền và không thao tác thanh toán — chỉ nấu và báo
 *  xong. Bấm "Chuyển qua phục vụ bàn" chỉ khi đã tick đủ tất cả món.
 * ================================================================== */

interface KitchenBoard {
  incoming: Order[];
  cooking: Order[];
}

/** Số món bếp đã tick xong. */
function doneCount(o: Order): number {
  return o.items.filter((i) => i.kitchen_done_at).length;
}

export function KitchenBoardPage() {
  const toast = useToast();
  const { user } = useStaffAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);

  const state = useAsync<KitchenBoard>(
    (signal) => api.get<KitchenBoard>('/kitchen/orders', { signal }),
    [],
  );

  useLiveStream(tokenStore.getStaffToken(), (e) => {
    if (e.type.startsWith('order.')) state.reload();
  });

  const incoming = state.data?.incoming ?? [];
  const cooking = state.data?.cooking ?? [];
  const pendingTotal = incoming.length + cooking.length;

  /** Gọi 1 API bếp rồi làm mới bảng. */
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      state.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Thao tác thất bại.');
    } finally {
      setBusy(null);
    }
  };

  const accept = (o: Order) =>
    run(o.order_no + 'accept', async () => {
      await api.post(`/kitchen/orders/${o.order_no}/accept`);
      toast.success(`Đã nhận đơn ${o.order_no}`);
    });

  const toggleItem = (o: Order, it: OrderItem) =>
    run(`${o.order_no}:${it.id}`, async () => {
      await api.patch(`/kitchen/orders/${o.order_no}/items/${it.id}`, { done: !it.kitchen_done_at });
    });

  const finish = (o: Order) =>
    run(o.order_no + 'finish', async () => {
      await api.post(`/kitchen/orders/${o.order_no}/finish`);
      toast.success(`Đơn ${o.order_no} đã trả lại phục vụ bàn.`);
    });

  // Mở tab in đơn bếp rồi tự đóng lại — đơn giấy, không phải hoá đơn tính tiền.
  const openPrint = (orderNo: string) => {
    setPrinting(orderNo);
    const w = window.open(`/kitchen/print?order=${encodeURIComponent(orderNo)}`, '_blank');
    if (!w) toast.error('Trình duyệt chặn cửa sổ mới. Hãy cho phép popup để in đơn.');
    setPrinting(null);
  };

  return (
    <AppLayout
      role="kitchen"
      sections={KITCHEN_SECTIONS}
      title="Bảng bếp"
      subtitle={
        pendingTotal === 0
          ? 'Chưa có đơn nào cần nấu'
          : `${incoming.length} đơn chờ nhận · ${cooking.length} đơn đang làm`
      }
      actions={
        user?.branch_name ? <span className="badge badge-info">🏢 {user.branch_name}</span> : null
      }
      onRefresh={state.reload}
      refreshing={state.loading}
    >
      <AsyncBlock
        loading={state.loading && pendingTotal === 0 && !state.data}
        error={state.error}
        loadingText="Đang tải bảng bếp..."
        empty={pendingTotal === 0 ? (
          <div className="empty">
            <div className="icon">🍳</div>
            <div className="strong">Bếp đang rảnh</div>
            <div className="small">
              Khi phục vụ bàn chuyển đơn qua, đơn sẽ hiện ở đây ngay.
            </div>
          </div>
        ) : undefined}
      >
        {/* ---- ③ Chờ bếp nhận ---- */}
        {incoming.length > 0 ? (
          <section className="kb-section">
            <h3 className="kb-head">
              📨 Chờ bếp nhận <span className="badge badge-warn">{incoming.length}</span>
            </h3>
            <div className="kb-grid">
              {incoming.map((o) => (
                <div className="kb-card new" key={o.id}>
                  <KitchenHead order={o} />
                  <KitchenItems order={o} />
                  <div className="kb-foot">
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busy === o.order_no + 'print'}
                      onClick={() => openPrint(o.order_no)}
                      type="button"
                    >
                      🖨 In đơn bếp
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busy === o.order_no + 'accept'}
                      onClick={() => void accept(o)}
                      type="button"
                    >
                      {busy === o.order_no + 'accept' ? <span className="spinner" /> : '🍳'} Nhận đơn
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ---- ④ Đang làm ---- */}
        {cooking.length > 0 ? (
          <section className="kb-section" style={incoming.length > 0 ? { marginTop: 22 } : undefined}>
            <h3 className="kb-head">
              🔥 Đang làm <span className="badge badge-info">{cooking.length}</span>
            </h3>
            <div className="kb-grid">
              {cooking.map((o) => {
                const done = doneCount(o);
                const all = o.items.length;
                const ready = done === all;
                return (
                  <div className={`kb-card ${ready ? 'ready' : ''}`} key={o.id}>
                    <KitchenHead order={o} showFrom="kitchen" />

                    {/* Tiến độ món: 2/3 món xong */}
                    <div className="kb-progress" title={`${done}/${all} món đã xong`}>
                      <div className="kb-progress-bar">
                        <span style={{ width: `${all ? Math.round((done / all) * 100) : 0}%` }} />
                      </div>
                      <span className="tiny strong mono">
                        {done}/{all} món
                      </span>
                    </div>

                    <KitchenItems order={o} onToggle={(it) => void toggleItem(o, it)} />

                    <div className="kb-foot">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => openPrint(o.order_no)}
                        type="button"
                      >
                        🖨 In đơn bếp
                      </button>
                      <button
                        className="btn btn-success btn-sm"
                        disabled={!ready || busy === o.order_no + 'finish'}
                        onClick={() => void finish(o)}
                        title={
                          ready
                            ? 'Trả đơn lại cho phục vụ bàn'
                            : `Còn ${all - done} món chưa tick hoàn thành`
                        }
                        type="button"
                      >
                        {busy === o.order_no + 'finish' ? <span className="spinner" /> : '🍽'} Chuyển qua phục vụ bàn
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </AsyncBlock>

      {printing ? null : null}
    </AppLayout>
  );
}

/* ------------------------------------------------------------------ *
 *  Khối con dùng lại
 * ------------------------------------------------------------------ */

/** Đầu thẻ: bàn, mã đơn, khách, đồng hồ. */
function KitchenHead({
  order,
  showFrom = 'kitchen',
}: {
  order: Order;
  /** Mốc đếm ngược: từ khi bếp nhận hay từ lúc phục vụ bàn gửi qua. */
  showFrom?: 'kitchen';
}) {
  // Đồng hồ đếm từ lúc phục vụ bàn chuyển qua (đã nhận ở bếp thì tính từ lúc
  // phục vụ gửi) — đủ để biết đơn nào đang chậm.
  const since = order.sent_to_kitchen_at ?? order.kitchen_received_at ?? order.started_at;
  return (
    <div className="kb-head-card">
      <div className="kb-title">
        <span className="badge badge-brand">🪑 {order.table_name ?? '—'}</span>
        <span className="mono strong">{order.order_no}</span>
        {order.table_branch_name ? <span className="badge">🏢 {order.table_branch_name}</span> : null}
      </div>
      <div className="tiny muted kb-sub">
        👤 {order.customer_name} · ☎ {order.customer_phone} · 🕐 {formatTime(order.started_at)}
      </div>
      <div className="kb-sub2">
        <RealtimeClock from={since} label={showFrom === 'kitchen' ? 'từ lúc bếp nhận' : 'chờ'} />
        {order.received_by_name ? (
          <span className="tiny muted">PV gửi: {order.received_by_name}</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Danh sách món. Khi có `onToggle` thì mỗi món là nút bấm để tick xong —
 * bấm lại để bỏ tick (sửa khi nhầm).
 */
function KitchenItems({ order, onToggle }: { order: Order; onToggle?: (it: OrderItem) => void }) {
  return (
    <ul className="kb-items">
      {order.items.map((it) => {
        const done = !!it.kitchen_done_at;
        const body = (
          <>
            <span className="kb-check" aria-hidden>
              {done ? '☑' : '☐'}
            </span>
            <span className="kb-qty">{it.quantity}×</span>
            <span className="grow">
              <span className="kb-dish">{it.dish_name}</span>
              {it.options?.length ? (
                <span className="kb-opts">
                  {it.options.map((op, i) => (
                    <span key={i}>
                      {op.group_name}: <strong>{op.option_name}</strong>
                      {i < it.options.length - 1 ? ' · ' : ''}
                    </span>
                  ))}
                </span>
              ) : null}
              {it.note ? <span className="kb-note">📝 {it.note}</span> : null}
              {done && it.kitchen_done_by_name ? (
                <span className="tiny muted">✓ {it.kitchen_done_by_name} · {formatTime(it.kitchen_done_at)}</span>
              ) : null}
            </span>
          </>
        );

        return (
          <li key={it.id}>
            {onToggle ? (
              <button
                className={`kb-item ${done ? 'done' : ''}`}
                onClick={() => onToggle(it)}
                disabled={done && !onToggle}
                type="button"
              >
                {body}
              </button>
            ) : (
              <div className={`kb-item ${done ? 'done' : ''} static`}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Link phụ ở chân trang: bảng bếp luôn là màn chính nên không cần điều hướng. */
export function KitchenBackLink() {
  return <Link to="/kitchen">← Bảng bếp</Link>;
}
