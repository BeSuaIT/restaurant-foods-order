import { useMemo, useState } from 'react';
import { AsyncBlock } from '../../components/PageParts';
import { Link } from 'react-router-dom';
import { api, tokenStore } from '../../lib/http';
import { formatMoney, timeAgo } from '../../lib/format';
import { useAsync } from '../../hooks/useAsync';
import { useLiveStream } from '../../hooks/useLiveStream';
import { useStaffAuth } from '../../hooks/useStaffAuth';
import { ADMIN_SECTIONS, AppLayout, STAFF_SECTIONS } from '../../components/AppLayout';
import { BillModal } from '../../components/BillModal';
import { StatusBadge } from '../../components/OrderBits';
import { RealtimeClock } from '../../components/RealtimeClock';
import { ACTIVE_ORDER_STATUSES, type Branch, type Order, type RestTable } from '../../types';

interface TableWithOrders extends RestTable {
  active_order_count: number;
}

/** Bàn đang phục vụ: ai ngồi bàn nào, đã order gì */
export function StaffTables() {
  const { user } = useStaffAuth();
  const isAdmin = user?.role === 'admin';
  const [billNo, setBillNo] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<'' | number>('');

  const branches = useAsync<Branch[]>(
    (signal) => api.get<Branch[]>('/staff/branches', { signal }),
    [],
    { enabled: isAdmin },
  );

  const qs = branchFilter === '' ? '' : `&branch_id=${branchFilter}`;
  const tables = useAsync<TableWithOrders[]>(
    (signal) => api.get<TableWithOrders[]>(`/staff/tables${qs ? `?${qs.slice(1)}` : ''}`, { signal }),
    [qs],
  );
  const orders = useAsync<{ rows: Order[]; total: number }>(
    (signal) =>
      api.get<{ rows: Order[]; total: number }>(
        `/staff/orders?status=${ACTIVE_ORDER_STATUSES.join(',')}&limit=200${qs}`,
        { signal },
      ),
    [qs],
  );

  useLiveStream(tokenStore.getStaffToken(), (e) => {
    if (e.type.startsWith('order.') || e.type === 'table.updated') {
      tables.reload();
      orders.reload();
    }
  });

  const openOrders = orders.data?.rows ?? [];

  const byTable = useMemo(() => {
    const map = new Map<number, Order[]>();
    for (const o of openOrders) {
      if (o.table_id == null) continue;
      const arr = map.get(o.table_id) ?? [];
      arr.push(o);
      map.set(o.table_id, arr);
    }
    return map;
  }, [openOrders]);

  const rows = tables.data ?? [];

  return (
    <AppLayout
      role="staff"
      sections={isAdmin ? ADMIN_SECTIONS : STAFF_SECTIONS}
      title="Bàn đang phục vụ"
      subtitle={`${rows.filter((t) => t.active_order_count > 0).length}/${rows.length} bàn có khách`}
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
      onRefresh={() => {
        tables.reload();
        orders.reload();
      }}
      refreshing={tables.loading || orders.loading}
    >
      {user && user.role === 'staff' && user.branch_id === null ? (
        <div className="alert alert-warn">
          ⚠️ Tài khoản của bạn <strong>chưa được gán cơ sở</strong> nên không thấy bàn nào.
          Vui lòng liên hệ Admin gán cơ sở trong trang <em>Quản lý tài khoản</em>.
        </div>
      ) : null}

      <AsyncBlock
        loading={tables.loading}
        error={tables.error}
        loadingText="Đang tải..."
        empty={rows.length === 0 ? (
          <div className="empty">
            <div className="icon">🪑</div>
            <div>Chưa có bàn nào</div>
          </div>
        ) : undefined}
      >
        <div className="t-grid">
          {rows.map((t) => {
            const list = byTable.get(t.id) ?? [];
            const total = list.reduce((s, o) => s + Number(o.total), 0);
            const unpaid = list.filter((o) => o.status !== 'paid');
            const unpaidTotal = unpaid.reduce((s, o) => s + Number(o.total), 0);
            const last = list[0];

            return (
              <div key={t.id} className={`t-card ${unpaid.length ? 'busy' : ''}`}>
                <div className="t-code">{t.code}</div>
                <div className="t-name">{t.name}</div>
                <div className="t-meta">
                  {t.branch_name ? `🏢 ${t.branch_name} · ` : ''}
                  {t.area ?? '—'} · {t.seats} chỗ
                </div>

                {list.length === 0 ? (
                  <div className="badge mt-10">
                    Trống
                  </div>
                ) : (
                  <div style={{ marginTop: 10, textAlign: 'left' }}>
                    <div className="badge badge-warn" style={{ marginBottom: 7 }}>
                      {list.length} đơn · {formatMoney(total)}
                    </div>
                    {last ? (
                      <>
                        <div className="tiny strong truncate">{last.customer_name}</div>
                        <div className="tiny muted">
                          {formatMoney(last.total)} · {timeAgo(last.started_at)}
                        </div>
                      </>
                    ) : null}
                    {unpaid.length > 0 ? (
                      <div className="tiny" style={{ color: 'var(--brand-dark)', marginTop: 4, fontWeight: 700 }}>
                        Cần thu {formatMoney(unpaidTotal)}
                      </div>
                    ) : null}
                  </div>
                )}

                <div className="row" style={{ gap: 6, marginTop: 11, justifyContent: 'center' }}>
                  <Link className="btn btn-ghost btn-sm" to={`/staff/orders?q=${t.code}`}>
                    Đơn
                  </Link>
                  {unpaid.length > 0 ? (
                    <Link className="btn btn-sm" to="/staff/payments">
                      💰 Thu tiền
                    </Link>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </AsyncBlock>

      {/* Danh sách đơn theo bàn */}
      {openOrders.length > 0 ? (
        <div className="s-panel" style={{ marginTop: 20 }}>
          <div className="s-panel-head">
            <h3>Đơn đang mở</h3>
            <span className="badge">{openOrders.length} đơn</span>
          </div>
          <div className="s-panel-body flush">
            <div className="table-wrap flush">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Bàn</th>
                    <th>Đơn</th>
                    <th>Khách</th>
                    <th>Món</th>
                    <th>Trạng thái</th>
                    <th className="right">Tổng</th>
                    <th>NV</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {openOrders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <strong>{o.table_code}</strong>
                      </td>
                      <td className="mono tiny">{o.order_no}</td>
                      <td>
                        <div className="small strong">{o.customer_name}</div>
                        <div className="tiny muted">{o.customer_phone}</div>
                      </td>
                      <td className="small">{o.items.reduce((s, i) => s + i.quantity, 0)} món</td>
                      <td>
                        <StatusBadge status={o.status} />
                      </td>
                      <td className="right strong">{formatMoney(o.total)}</td>
                      <td className="tiny">{o.received_by_name ?? '—'}</td>
                      <td className="right">
                        <button className="btn btn-ghost btn-sm" onClick={() => setBillNo(o.order_no)} type="button">
                          🧾 bill
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---- Popup xem hóa đơn ---- */}
      <BillModal orderNo={billNo} onClose={() => setBillNo(null)} />
    </AppLayout>
  );
}
