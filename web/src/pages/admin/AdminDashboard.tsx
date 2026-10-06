import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BranchFilter } from '../../components/PageParts';
import { api, tokenStore } from '../../lib/http';
import { formatMoney, timeAgo } from '../../lib/format';
import { useAsync } from '../../hooks/useAsync';
import { useLiveStream } from '../../hooks/useLiveStream';
import { ADMIN_SECTIONS, AppLayout } from '../../components/AppLayout';
import { BillModal } from '../../components/BillModal';
import { StatusBadge } from '../../components/OrderBits';
import type { Branch, DashboardStats, Order } from '../../types';

/* ================================================================== *
 *  Bảng điều khiển Admin
 * ================================================================== */

export function AdminDashboard() {
  const [billNo, setBillNo] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<'' | number>('');

  const branches = useAsync<Branch[]>((signal) => api.get<Branch[]>('/admin/branches', { signal }), []);
  const qs = branchFilter === '' ? '' : `?branch_id=${branchFilter}`;

  const stats = useAsync<DashboardStats>((signal) => api.get<DashboardStats>(`/admin/stats${qs}`, { signal }), [qs]);
  const recent = useAsync<{ rows: Order[]; total: number }>(
    (signal) => api.get<{ rows: Order[]; total: number }>(`/admin/orders?limit=8${qs}`, { signal }),
    [qs],
  );

  useLiveStream(tokenStore.getStaffToken(), (e) => {
    if (e.type.startsWith('order.')) {
      stats.reload();
      recent.reload();
    }
  });

  const s = stats.data;
  const maxTop = Math.max(1, ...(s?.topDishes ?? []).map((d) => d.quantity));
  const branchName = branchFilter === '' ? null : (branches.data ?? []).find((b) => b.id === branchFilter)?.name;

  return (
    <AppLayout
      role="admin"
      sections={ADMIN_SECTIONS}
      title="Bảng điều khiển"
      subtitle={
        branchName ? `Tổng quan ${branchName} hôm nay` : 'Tổng quan hoạt động nhà hàng hôm nay'
      }
      actions={
        <BranchFilter branchFilter={branchFilter} onChange={setBranchFilter} branches={branches.data ?? []} />
      }
      onRefresh={() => {
        stats.reload();
        recent.reload();
      }}
      refreshing={stats.loading || recent.loading}
    >
      {stats.loading ? (
        <div className="loading-box">Đang tải...</div>
      ) : stats.error ? (
        <div className="alert alert-error">{stats.error}</div>
      ) : s ? (
        <>
          <div className="s-stats">
            <div className="s-stat accent">
              <div className="lbl">Doanh thu hôm nay</div>
              <div className="val">{formatMoney(s.today.revenue)}</div>
              <div className="sub">Tiền mặt: {formatMoney(s.today.cash)}</div>
            </div>
            <div className="s-stat">
              <div className="lbl">Đơn hôm nay</div>
              <div className="val">{s.today.orders}</div>
              <div className="sub">{s.today.items} món đã bán</div>
            </div>
            <div className="s-stat red">
              <div className="lbl">Chờ xác nhận</div>
              <div className="val">{s.counts.pending}</div>
              <div className="sub">cần nhân viên xử lý</div>
            </div>
            <div className="s-stat blue">
              <div className="lbl">Chưa thanh toán</div>
              <div className="val">{s.counts.confirmed + s.counts.served}</div>
              <div className="sub">đang phục vụ</div>
            </div>
          </div>

          <div className="row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="s-panel s-panel-fit">
              <div className="s-panel-head">
                <h3>🏆 Món bán chạy hôm nay</h3>
              </div>
              <div className="s-panel-body">
                {s.topDishes.length === 0 ? (
                  <div className="muted small">Chưa có dữ liệu hôm nay.</div>
                ) : (
                  s.topDishes.map((d) => (
                    <div key={d.name} style={{ marginBottom: 12 }}>
                      <div className="row-between small" style={{ marginBottom: 4 }}>
                        <span className="strong truncate">{d.name}</span>
                        <span className="nowrap muted">
                          {d.quantity} món · {formatMoney(d.revenue)}
                        </span>
                      </div>
                      <div style={{ height: 7, background: 'var(--muted-bg)', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{ width: `${(d.quantity / maxTop) * 100}%`, height: '100%', background: 'linear-gradient(90deg, var(--brand), #fb923c)' }} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="s-panel" style={{ flex: '1 1 340px', marginBottom: 0 }}>
              <div className="s-panel-head">
                <h3>👨‍🍳 Nhân viên hôm nay</h3>
              </div>
              <div className="s-panel-body flush">
                {s.recentStaff.length === 0 ? (
                  <div className="muted small pad-17">
                    Chưa có nhân viên nào xử lý đơn hôm nay.
                  </div>
                ) : (
                  <table className="tbl minw-0">
                    <thead>
                      <tr>
                        <th>Nhân viên</th>
                        <th className="right">Nhận order</th>
                        <th className="right">Thu tiền</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.recentStaff.map((u) => (
                        <tr key={u.full_name}>
                          <td>{u.full_name}</td>
                          <td className="right">{u.received}</td>
                          <td className="right strong">{u.paid}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          <div className="s-panel mt-18">
            <div className="s-panel-head">
              <h3>Đơn gần đây</h3>
              <Link className="btn btn-ghost btn-sm" to="/admin/history">
                Xem toàn bộ lịch sử →
              </Link>
            </div>
            <div className="s-panel-body flush">
              {(recent.data?.rows.length ?? 0) === 0 ? (
                <div className="empty" style={{ padding: 30 }}>
                  <div className="icon">📭</div>
                  <div>Chưa có đơn nào</div>
                </div>
              ) : (
                <div className="table-wrap flush">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Mã đơn</th>
                        <th>Bàn</th>
                        <th>Cơ sở</th>
                        <th>Khách</th>
                        <th>Trạng thái</th>
                        <th className="right">Tổng</th>
                        <th>Thời gian</th>
                        <th>NV</th>
                        <th className="right"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.data!.rows.map((o) => (
                        <tr key={o.id}>
                          <td className="mono tiny">{o.order_no}</td>
                          <td>
                            <strong>{o.table_code ?? '—'}</strong>
                          </td>
                          <td className="tiny nowrap">{o.table_branch_name ?? '—'}</td>
                          <td className="small nowrap">
                            <div>{o.customer_name}</div>
                            <div className="tiny muted">{o.customer_phone}</div>
                          </td>
                          <td>
                            <StatusBadge status={o.status} />
                          </td>
                          <td className="right strong nowrap">{formatMoney(o.total)}</td>
                          <td className="tiny muted nowrap">{timeAgo(o.created_at)}</td>
                          <td className="tiny nowrap">{o.received_by_name ?? '—'}</td>
                          <td className="right">
                            <button className="btn btn-ghost btn-sm" onClick={() => setBillNo(o.order_no)} type="button">
                              🧾
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}

      {/* ---- Popup xem hóa đơn ---- */}
      <BillModal orderNo={billNo} onClose={() => setBillNo(null)} />
    </AppLayout>
  );
}
