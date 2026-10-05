import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api,
  formatMoney,
  timeAgo,
  tokenStore,
  useAsync,
  useLiveStream,
} from '../../api';
import { useToast } from '../../components/Toast';
import type { Dish, Order, OrderStatus } from '../../types';

/* ================================================================== *
 *  Kiểu dữ liệu cục bộ
 * ================================================================== */

interface MenuResponse {
  dishes: Dish[];
  categories: string[];
}

interface SessionInfo {
  customer_name: string;
  customer_phone: string;
  table: {
    id: number;
    code: string;
    name: string;
    area: string | null;
    branch_name?: string | null;
  };
}

type Selection = Record<number, number[]>;

/* ================================================================== *
 *  Modal chọn tuỳ chọn đi kèm
 * ================================================================== */

function OptionModal({
  dish,
  onClose,
  onConfirm,
  busy,
}: {
  dish: Dish;
  onClose: () => void;
  onConfirm: (selections: Selection, qty: number, note: string) => void;
  busy: boolean;
}) {
  const groups = dish.option_groups ?? [];
  const [sel, setSel] = useState<Selection>(() => {
    const init: Selection = {};
    for (const g of groups) init[g.id] = g.items.filter((i) => i.is_default).map((i) => i.id);
    return init;
  });
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const toggle = (groupId: number, optionId: number, multiple: boolean, max: number) => {
    setSel((prev) => {
      const cur = prev[groupId] ?? [];
      if (!multiple) return { ...prev, [groupId]: [optionId] };
      if (cur.includes(optionId)) return { ...prev, [groupId]: cur.filter((x) => x !== optionId) };
      if (cur.length >= max) return prev;
      return { ...prev, [groupId]: [...cur, optionId] };
    });
  };

  const extra = useMemo(
    () =>
      groups.reduce((sum, g) => {
        const chosen = sel[g.id] ?? [];
        return (
          sum +
          g.items.filter((i) => chosen.includes(i.id)).reduce((s, i) => s + Number(i.price_delta), 0)
        );
      }, 0),
    [groups, sel],
  );

  const missing = groups.filter(
    (g) => (sel[g.id]?.length ?? 0) < (g.is_required ? Math.max(1, g.min_select) : g.min_select),
  );

  const unit = Number(dish.price) + extra;

  return (
    <div className="c-drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="c-drawer" style={{ maxWidth: 560 }}>
        <div className="c-drawer-handle" />
        <div className="c-drawer-header">
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            {dish.image_url ? (
              <img
                src={dish.image_url}
                alt={dish.name}
                style={{ width: 66, height: 66, borderRadius: 11, objectFit: 'cover', flex: 'none' }}
              />
            ) : (
              <div
                style={{
                  width: 66,
                  height: 66,
                  borderRadius: 11,
                  background: 'var(--muted-bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 30,
                  flex: 'none',
                }}
              >
                🍽️
              </div>
            )}
            <div className="grow">
              <h3 style={{ fontSize: 16.5 }}>{dish.name}</h3>
              <div className="c-price" style={{ marginTop: 3 }}>
                {formatMoney(dish.price)}
              </div>
              {dish.description ? (
                <div className="small muted" style={{ marginTop: 4 }}>
                  {dish.description}
                </div>
              ) : null}
            </div>
            <button className="modal-close" onClick={onClose} aria-label="Đóng" type="button">
              ✕
            </button>
          </div>
        </div>

        <div className="c-drawer-body">
          {groups.map((g) => (
            <div key={g.id} style={{ marginBottom: 20 }}>
              <div className="row-between" style={{ marginBottom: 4 }}>
                <strong style={{ fontSize: 14.5 }}>{g.name}</strong>
                <span className={`badge ${g.is_required ? 'badge-danger' : ''}`}>
                  {g.is_required ? 'Bắt buộc' : 'Tuỳ chọn'}
                  {g.is_multiple ? ` · tối đa ${g.max_select}` : ''}
                </span>
              </div>
              {g.description ? (
                <div className="tiny muted" style={{ marginBottom: 8 }}>
                  {g.description}
                </div>
              ) : null}

              <div className="c-option-list">
                {g.items.map((it) => {
                  const selected = (sel[g.id] ?? []).includes(it.id);
                  // Nhóm CHỌN 1: không bao giờ khoá — người dùng phải đổi lựa chọn được.
                  // (Lỗi cũ: khi đã chọn 1 mục thì mọi mục khác bị disabled -> không đổi được.)
                  // Nhóm CHỌN NHIỀU: chỉ khoá mục chưa chọn khi đã đạt giới hạn tối đa.
                  const atMax =
                    g.is_multiple && !selected && (sel[g.id]?.length ?? 0) >= g.max_select;
                  return (
                    <label
                      key={it.id}
                      className={`c-option-row ${selected ? 'selected' : ''} ${atMax ? 'is-max' : ''}`}
                    >
                      <input
                        type={g.is_multiple ? 'checkbox' : 'radio'}
                        name={`grp-${g.id}`}
                        checked={selected}
                        disabled={atMax}
                        onChange={() => toggle(g.id, it.id, g.is_multiple, g.max_select)}
                      />
                      <span className="grow">{it.name}</span>
                      <span className="c-option-price">
                        {Number(it.price_delta) === 0 ? (
                          <span className="muted tiny">Miễn phí</span>
                        ) : Number(it.price_delta) > 0 ? (
                          `+${formatMoney(it.price_delta)}`
                        ) : (
                          formatMoney(it.price_delta)
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="opt-note">Ghi chú cho nhà bếp (không bắt buộc)</label>
            <input
              id="opt-note"
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: ít hành, thêm chút ớt..."
              maxLength={200}
            />
          </div>

          <div className="row-between" style={{ paddingTop: 8 }}>
            <span className="strong">Số lượng</span>
            <div className="c-qty">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1}>
                −
              </button>
              <span>{qty}</span>
              <button type="button" onClick={() => setQty((q) => Math.min(50, q + 1))} disabled={qty >= 50}>
                +
              </button>
            </div>
          </div>
        </div>

        <div className="c-drawer-footer">
          {missing.length > 0 ? (
            <div className="alert alert-warn" style={{ marginBottom: 10 }}>
              Vui lòng chọn: {missing.map((g) => g.name).join(', ')}
            </div>
          ) : null}
          <div className="row" style={{ gap: 10 }}>
            <div className="grow">
              <div className="tiny muted">Tạm tính</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--brand-dark)' }}>
                {formatMoney(unit * qty)}
              </div>
            </div>
            <button
              className="btn btn-lg"
              disabled={busy || missing.length > 0}
              onClick={() => onConfirm(sel, qty, note)}
            >
              {busy && <span className="spinner" />}
              Thêm vào đơn
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== *
 *  Drawer giỏ hàng
 * ================================================================== */

function CartDrawer({
  order,
  busyItemId,
  onClose,
  onQty,
  onSubmit,
  onClear,
  submitting,
}: {
  order: Order;
  busyItemId: number | null;
  onClose: () => void;
  onQty: (itemId: number, qty: number) => void;
  onSubmit: () => void;
  onClear: () => void;
  submitting: boolean;
}) {
  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="c-drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="c-drawer">
        <div className="c-drawer-handle" />
        <div className="c-drawer-header">
          <div className="row-between">
            <h3 style={{ fontSize: 16.5 }}>Đơn của bạn</h3>
            <button className="modal-close" onClick={onClose} aria-label="Đóng" type="button">
              ✕
            </button>
          </div>
          <div className="tiny muted" style={{ marginTop: 2 }}>
            {totalQty} món · Bắt đầu lúc {timeAgo(order.started_at)}
          </div>
        </div>

        <div className="c-drawer-body">
          {order.items.length === 0 ? (
            <div className="empty">
              <div className="icon">🛒</div>
              <div>Chưa chọn món nào</div>
              <div className="small">Chọn món ở danh sách phía trên nhé</div>
            </div>
          ) : (
            order.items.map((it) => (
              <div className="c-cart-item" key={it.id}>
                {it.dish_image_url ? (
                  <img src={it.dish_image_url} alt="" className="c-cart-thumb" />
                ) : (
                  <div className="c-cart-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
                    🍽️
                  </div>
                )}
                <div className="grow">
                  <div className="strong small">{it.dish_name}</div>
                  {it.options?.length ? (
                    <div className="tiny muted">
                      {it.options.map((o, i) => (
                        <span key={i}>
                          {o.option_name}
                          {Number(o.price_delta) > 0 ? ` (+${formatMoney(o.price_delta)})` : ''}
                          {i < it.options.length - 1 ? ' · ' : ''}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {it.note ? <div className="tiny muted">📝 {it.note}</div> : null}
                  <div className="row" style={{ marginTop: 7, gap: 10 }}>
                    <div className="c-qty">
                      <button
                        type="button"
                        disabled={busyItemId === it.id}
                        onClick={() => onQty(it.id, it.quantity - 1)}
                        aria-label="Giảm"
                      >
                        −
                      </button>
                      <span>{it.quantity}</span>
                      <button
                        type="button"
                        disabled={busyItemId === it.id || it.quantity >= 50}
                        onClick={() => onQty(it.id, it.quantity + 1)}
                        aria-label="Tăng"
                      >
                        +
                      </button>
                    </div>
                    <strong className="small">{formatMoney(it.line_total)}</strong>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="c-drawer-footer">
          <div className="c-totals">
            <div className="c-totals-row">
              <span>Tạm tính</span>
              <span>{formatMoney(order.subtotal)}</span>
            </div>
            <div className="c-totals-row grand">
              <span>Tổng cộng</span>
              <span>{formatMoney(order.total)}</span>
            </div>
          </div>

          {order.items.length > 0 ? (
            <>
              <button className="btn btn-block btn-lg" onClick={onSubmit} disabled={submitting}>
                {submitting && <span className="spinner" />}
                Gửi đơn cho nhà hàng
              </button>
              <button
                className="btn btn-ghost btn-block btn-sm"
                onClick={onClear}
                disabled={submitting}
                style={{ marginTop: 8 }}
              >
                Xoá tất cả món
              </button>
            </>
          ) : (
            <button className="btn btn-secondary btn-block" onClick={onClose}>
              Tiếp tục chọn món
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== *
 *  Màn hình order chính
 * ================================================================== */

export function Menu() {
  const nav = useNavigate();
  const toast = useToast();
  const tableToken = tokenStore.getTableToken();

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [cat, setCat] = useState<string>('Tất cả');
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState<Dish | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyItemId, setBusyItemId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Chưa có phiên bàn -> về trang nhập
  useEffect(() => {
    if (!tableToken) nav('/', { replace: true });
  }, [tableToken, nav]);

  const sessionState = useAsync<SessionInfo>(
    (signal) => api.get<SessionInfo>('/session/me', { signal }),
    [tableToken],
  );
  useEffect(() => {
    if (sessionState.data) setSession(sessionState.data);
  }, [sessionState.data]);

  const menu = useAsync<MenuResponse>((signal) => api.get<MenuResponse>('/menu', { signal }), []);
  const order = useAsync<Order>((signal) => api.get<Order>('/order/current', { signal }), [tableToken]);

  // Đơn đã gửi -> chuyển sang màn chờ
  const orderStatus = order.data?.status as OrderStatus | undefined;
  useEffect(() => {
    if (orderStatus && orderStatus !== 'draft' && order.data?.order_no) {
      nav(`/order/${order.data.order_no}`, { replace: true });
    }
  }, [orderStatus, order.data?.order_no, nav]);

  // Cập nhật thời gian thực
  useLiveStream(tableToken, (e) => {
    if (e.type === 'menu.updated') menu.reload();
    if (e.type.startsWith('order.')) {
      order.reload();
      sessionState.reload();
    }
  });

  const dishes = menu.data?.dishes ?? [];
  const categories = useMemo(() => {
    const set = new Set<string>();
    dishes.forEach((d) => d.category && set.add(d.category));
    return ['Tất cả', ...[...set].sort()];
  }, [dishes]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dishes.filter((d) => {
      if (cat !== 'Tất cả' && d.category !== cat) return false;
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        (d.description ?? '').toLowerCase().includes(q) ||
        (d.category ?? '').toLowerCase().includes(q)
      );
    });
  }, [dishes, cat, search]);

  const current = order.data;
  const totalQty = current?.items.reduce((s, i) => s + i.quantity, 0) ?? 0;

  const addSimple = useCallback(
    async (dish: Dish) => {
      if (!current || busy) return;
      setBusy(true);
      try {
        const updated = await api.post<Order>('/order/items', { dishId: dish.id, quantity: 1 });
        order.setData(updated);
        toast.success(`Đã thêm ${dish.name}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Không thêm được món.');
      } finally {
        setBusy(false);
      }
    },
    [current, busy, order, toast],
  );

  const pickDish = (dish: Dish) => {
    if (!dish.is_available) return;
    if (dish.option_groups?.length) setPicking(dish);
    else void addSimple(dish);
  };

  const confirmOptions = async (selections: Selection, qty: number, note: string) => {
    if (!picking) return;
    setBusy(true);
    try {
      const updated = await api.post<Order>('/order/items', {
        dishId: picking.id,
        quantity: qty,
        note: note || null,
        selections: Object.entries(selections).map(([groupId, optionIds]) => ({
          groupId: Number(groupId),
          optionIds,
        })),
      });
      order.setData(updated);
      toast.success(`Đã thêm ${qty}× ${picking.name}`);
      setPicking(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thêm được món.');
    } finally {
      setBusy(false);
    }
  };

  const changeQty = async (itemId: number, qty: number) => {
    setBusyItemId(itemId);
    try {
      const updated = await api.patch<Order>(`/order/items/${itemId}`, { quantity: qty });
      order.setData(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không cập nhật được.');
    } finally {
      setBusyItemId(null);
    }
  };

  const clearAll = async () => {
    setSubmitting(true);
    try {
      const updated = await api.del<Order>('/order/items');
      order.setData(updated);
      toast.info('Đã xoá toàn bộ món.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không xoá được.');
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const updated = await api.post<Order>('/order/submit');
      order.setData(updated);
      setCartOpen(false);
      toast.success('Đã gửi đơn! Nhà hàng sẽ xác nhận ngay.');
      nav(`/order/${updated.order_no}`, { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không gửi được đơn.');
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Khách bỏ phiên (không order nữa).
   *
   * Không có nút này thì mỗi lần quét QR là sinh 1 phiên + 1 đơn nháp trong DB.
   * Nhân viên nhìn thấy đống đơn chưa order dồn lại, và lần sau quét lại QR khách
   * vẫn bị đẩy vào phiên cũ. Bấm ở đây để xoá sạch cả hai.
   */
  const leaveSession = async () => {
    setSubmitting(true);
    try {
      await api.del('/order/session');
      tokenStore.clearTableToken();
      toast.info('Đã kết thúc phiên. Mời quét lại mã QR khi bạn muốn order.');
      nav('/', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không kết thúc được phiên.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!tableToken || sessionState.loading) {
    return <div className="loading-box">Đang tải menu...</div>;
  }

  if (sessionState.error) {
    tokenStore.clearTableToken();
    return (
      <div className="c-join">
        <div className="c-join-card">
          <div className="c-join-logo">⚠️</div>
          <h1>Phiên bàn không còn hợp lệ</h1>
          <p className="muted small" style={{ marginBottom: 18 }}>
            {sessionState.error}
          </p>
          <button
            className="btn btn-block btn-lg"
            onClick={() => {
              tokenStore.clearTableToken();
              nav('/', { replace: true });
            }}
          >
            Quét lại mã QR
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="c-shell">
      <header className="c-topbar">
        <div className="c-topbar-inner">
          <span className="c-table-pill">
            🪑 {session?.table.name ?? '—'}
            {session?.table.branch_name ? ` · ${session.table.branch_name}` : ''}
          </span>
          <div className="grow c-customer">
            {session?.customer_name} · {session?.customer_phone}
          </div>
          <button
            className="c-leave"
            onClick={() => {
              if (
                window.confirm(
                  'Kết thúc phiên order?\n\nĐơn chưa gửi của bạn sẽ bị xoá và phiên này đóng lại. ' +
                    'Bạn cần quét lại mã QR trên bàn khi muốn order tiếp.',
                )
              ) {
                void leaveSession();
              }
            }}
            disabled={submitting}
            title="Đóng phiên order (không order nữa)"
            type="button"
          >
            {submitting ? <span className="spinner" /> : '✕'} Kết thúc phiên
          </button>
        </div>
      </header>

      <main className="c-menu">
        <div className="c-search" style={{ marginTop: 14 }}>
          <span className="ico">🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm món ăn..."
            aria-label="Tìm món ăn"
          />
        </div>

        <div className="c-cats">
          {categories.map((c) => (
            <button
              key={c}
              className={`c-cat ${cat === c ? 'active' : ''}`}
              onClick={() => setCat(c)}
              type="button"
            >
              {c}
            </button>
          ))}
        </div>

        {menu.loading ? (
          <div className="loading-box">Đang tải thực đơn...</div>
        ) : menu.error ? (
          <div className="alert alert-error">{menu.error}</div>
        ) : visible.length === 0 ? (
          <div className="empty">
            <div className="icon">🔍</div>
            <div>Không tìm thấy món nào</div>
            <div className="small">Thử tìm với từ khóa khác</div>
          </div>
        ) : (
          <div className="c-dish-grid">
            {visible.map((d) => (
              <button
                key={d.id}
                className="c-dish"
                onClick={() => pickDish(d)}
                disabled={!d.is_available}
                type="button"
              >
                <div className="c-dish-img-wrap">
                  {d.image_url ? (
                    <img src={d.image_url} alt={d.name} className="c-dish-img" loading="lazy" />
                  ) : (
                    <div className="c-dish-img ph">🍽️</div>
                  )}
                  {!d.is_available ? <div className="c-sold-out">Hết món</div> : null}
                </div>
                <div className="c-dish-body">
                  <div className="c-dish-name">{d.name}</div>
                  {d.description ? <div className="c-dish-desc">{d.description}</div> : null}
                  {d.option_groups?.length ? (
                    <div>
                      <span className="c-opt-flag">⚙ Tuỳ chọn thêm</span>
                    </div>
                  ) : null}
                  <div className="c-dish-foot">
                    <span className="c-price">
                      {formatMoney(d.price)} <small>đ</small>
                    </span>
                    {!d.is_available ? null : (
                      <span className="btn btn-sm" aria-hidden>
                        +
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {current && totalQty > 0 ? (
        <div className="c-cart-bar">
          <div className="c-cart-bar-inner">
            <div className="c-cart-count" aria-hidden>
              🛒
            </div>
            <button className="grow" onClick={() => setCartOpen(true)} type="button" style={{ background: 'none', border: 'none', textAlign: 'left', padding: 0, cursor: 'pointer' }}>
              <div className="strong">
                {totalQty} món · {formatMoney(current.total)}
              </div>
              <div className="tiny" style={{ color: 'var(--brand)' }}>
                Xem & gửi đơn →
              </div>
            </button>
          </div>
        </div>
      ) : null}

      {picking ? (
        <OptionModal dish={picking} onClose={() => setPicking(null)} onConfirm={confirmOptions} busy={busy} />
      ) : null}

      {cartOpen && current ? (
        <CartDrawer
          order={current}
          busyItemId={busyItemId}
          onClose={() => setCartOpen(false)}
          onQty={changeQty}
          onSubmit={submit}
          onClear={clearAll}
          submitting={submitting}
        />
      ) : null}
    </div>
  );
}
