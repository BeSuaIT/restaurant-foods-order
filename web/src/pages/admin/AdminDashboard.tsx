import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDate, formatMoney, timeAgo, tokenStore, useAsync, useLiveStream } from '../../api';
import { ADMIN_SECTIONS, AppLayout } from '../../components/AppLayout';
import { BillModal } from '../../components/BillModal';
import { StatusBadge } from '../../components/OrderBits';
import type { Branch, DashboardStats, Order } from '../../types';

interface ReportData {
  daily: { day: string; orders: number; revenue: number; discount: number }[];
  byStaff: { id: number; full_name: string; paid_orders: number; revenue: number }[];
  byTable: { id: number; code: string; name: string; paid_orders: number; revenue: number }[];
  byDiscount: { code: string; orders: number; discount: number }[];
  totals: { orders: number; revenue: number; discount: number };
}

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
      }
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
            <div className="s-panel" style={{ flex: '1 1 380px', marginBottom: 0 }}>
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
                  <div className="muted small" style={{ padding: 17 }}>
                    Chưa có nhân viên nào xử lý đơn hôm nay.
                  </div>
                ) : (
                  <table className="tbl" style={{ minWidth: 0 }}>
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

          <div className="s-panel" style={{ marginTop: 18 }}>
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
                <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
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
                          <td className="tiny">{o.table_branch_name ?? '—'}</td>
                          <td className="small">
                            <div>{o.customer_name}</div>
                            <div className="tiny muted">{o.customer_phone}</div>
                          </td>
                          <td>
                            <StatusBadge status={o.status} />
                          </td>
                          <td className="right strong nowrap">{formatMoney(o.total)}</td>
                          <td className="tiny muted nowrap">{timeAgo(o.created_at)}</td>
                          <td className="tiny">{o.received_by_name ?? '—'}</td>
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

/* ================================================================== *
 *  Báo cáo doanh thu
 * ================================================================== */

const todayStr = () => new Date().toISOString().slice(0, 10);
const daysAgoStr = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export function AdminReports() {
  const [from, setFrom] = useState(daysAgoStr(30));
  const [to, setTo] = useState(todayStr());
  const [branchFilter, setBranchFilter] = useState<'' | number>('');

  const branches = useAsync<Branch[]>((signal) => api.get<Branch[]>('/admin/branches', { signal }), []);

  const state = useAsync<ReportData>(
    (signal) =>
      api.get<ReportData>(
        `/admin/reports?from=${encodeURIComponent(from + 'T00:00:00')}&to=${encodeURIComponent(to + 'T23:59:59')}${
          branchFilter === '' ? '' : `&branch_id=${branchFilter}`
        }`,
        { signal },
      ),
    [from, to, branchFilter],
  );

  const r = state.data;
  const maxDay = Math.max(1, ...(r?.daily ?? []).map((d) => d.revenue));

  const exportCsv = () => {
    if (!r) return;
    const rows = [
      ['Ngày', 'Số đơn', 'Doanh thu', 'Giảm trừ'],
      ...r.daily.map((d) => [d.day, d.orders, d.revenue, d.discount]),
    ];
    const csv = '﻿' + rows.map((x) => x.join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `doanh-thu_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout
      role="admin"
      sections={ADMIN_SECTIONS}
      title="Báo cáo doanh thu"
      subtitle={`${formatDate(from)} → ${formatDate(to)}`}
      actions={
        <>
          <select
            className="input"
            style={{ width: 190, padding: '7px 10px' }}
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
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!r?.daily.length} type="button">
            ⬇ Xuất CSV
          </button>
        </>
      }
    >
      <div className="s-filters">
        <div className="field">
          <label htmlFor="rf">Từ ngày</label>
          <input id="rf" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rt">Đến ngày</label>
          <input id="rt" className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="row" style={{ gap: 6, paddingBottom: 2 }}>
          {[
            { label: '7 ngày', n: 7 },
            { label: '30 ngày', n: 30 },
            { label: '90 ngày', n: 90 },
          ].map((p) => (
            <button
              key={p.n}
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setFrom(daysAgoStr(p.n));
                setTo(todayStr());
              }}
              type="button"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {state.loading ? (
        <div className="loading-box">Đang tải báo cáo...</div>
      ) : state.error ? (
        <div className="alert alert-error">{state.error}</div>
      ) : r ? (
        <>
          <div className="s-stats">
            <div className="s-stat accent">
              <div className="lbl">Tổng doanh thu</div>
              <div className="val">{formatMoney(r.totals.revenue)}</div>
            </div>
            <div className="s-stat">
              <div className="lbl">Tổng đơn đã thanh toán</div>
              <div className="val">{r.totals.orders}</div>
            </div>
            <div className="s-stat red">
              <div className="lbl">Tổng giảm trừ</div>
              <div className="val">{formatMoney(r.totals.discount)}</div>
            </div>
            <div className="s-stat green">
              <div className="lbl">TB mỗi đơn</div>
              <div className="val">
                {formatMoney(r.totals.orders ? r.totals.revenue / r.totals.orders : 0)}
              </div>
            </div>
          </div>

          <div className="s-panel">
            <div className="s-panel-head">
              <h3>📈 Doanh thu theo ngày</h3>
              <span className="badge">{r.daily.length} ngày có dữ liệu</span>
            </div>
            <div className="s-panel-body">
              {r.daily.length === 0 ? (
                <div className="muted small">Không có đơn đã thanh toán trong khoảng thời gian này.</div>
              ) : (
                r.daily.map((d) => (
                  <div key={d.day} style={{ marginBottom: 12 }}>
                    <div className="row-between small" style={{ marginBottom: 4 }}>
                      <span className="strong">{formatDate(d.day)}</span>
                      <span className="nowrap muted">
                        {d.orders} đơn · <strong style={{ color: 'var(--brand-dark)' }}>{formatMoney(d.revenue)}</strong>
                        {Number(d.discount) > 0 ? ` · giảm ${formatMoney(d.discount)}` : ''}
                      </span>
                    </div>
                    <div style={{ height: 8, background: 'var(--muted-bg)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ width: `${(d.revenue / maxDay) * 100}%`, height: '100%', background: 'linear-gradient(90deg, var(--brand), #fb923c)' }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="s-panel" style={{ flex: '1 1 380px', marginBottom: 0 }}>
              <div className="s-panel-head">
                <h3>👨‍🍳 Theo nhân viên thanh toán</h3>
              </div>
              <div className="s-panel-body flush">
                {r.byStaff.length === 0 ? (
                  <div className="muted small" style={{ padding: 17 }}>
                    Không có dữ liệu.
                  </div>
                ) : (
                  <table className="tbl" style={{ minWidth: 0 }}>
                    <thead>
                      <tr>
                        <th>Nhân viên</th>
                        <th className="right">Số đơn</th>
                        <th className="right">Doanh thu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.byStaff.map((s2) => (
                        <tr key={s2.id}>
                          <td>{s2.full_name}</td>
                          <td className="right">{s2.paid_orders}</td>
                          <td className="right strong">{formatMoney(s2.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="s-panel" style={{ flex: '1 1 380px', marginBottom: 0 }}>
              <div className="s-panel-head">
                <h3>🪑 Theo bàn</h3>
              </div>
              <div className="s-panel-body flush">
                {r.byTable.length === 0 ? (
                  <div className="muted small" style={{ padding: 17 }}>
                    Không có dữ liệu.
                  </div>
                ) : (
                  <table className="tbl" style={{ minWidth: 0 }}>
                    <thead>
                      <tr>
                        <th>Bàn</th>
                        <th className="right">Số đơn</th>
                        <th className="right">Doanh thu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.byTable.map((t) => (
                        <tr key={t.id}>
                          <td>
                            <strong>{t.code}</strong> <span className="tiny muted">{t.name}</span>
                          </td>
                          <td className="right">{t.paid_orders}</td>
                          <td className="right strong">{formatMoney(t.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {(r.byDiscount?.length ?? 0) > 0 ? (
            <div className="s-panel" style={{ marginTop: 18 }}>
              <div className="s-panel-head">
                <h3>🎟️ Theo mã giảm giá</h3>
                <span className="badge">{r.byDiscount.length} mã</span>
              </div>
              <div className="s-panel-body flush">
                <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                  <table className="tbl" style={{ minWidth: 0 }}>
                    <thead>
                      <tr>
                        <th>Mã</th>
                        <th className="right">Số đơn</th>
                        <th className="right">Tổng tiền giảm</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.byDiscount.map((d) => (
                        <tr key={d.code}>
                          <td>
                            <strong className="mono">{d.code}</strong>
                          </td>
                          <td className="right">{d.orders}</td>
                          <td className="right strong" style={{ color: 'var(--danger)' }}>
                            −{formatMoney(d.discount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </AppLayout>
  );
}
