import { useState } from 'react';
import { BranchFilter } from '../../components/PageParts';
import { api } from '../../lib/http';
import { formatDate, formatMoney } from '../../lib/format';
import { useAsync } from '../../hooks/useAsync';
import { ADMIN_SECTIONS, AppLayout } from '../../components/AppLayout';
import { AreaChart, BarChart, DonutChart, HBarChart } from '../../components/Charts';
import type { Branch } from '../../types';

/** Dữ liệu tổng hợp trả về từ GET /admin/reports. */
interface ReportData {
  daily: { day: string; orders: number; revenue: number; discount: number }[];
  byHour: { hour: number; orders: number; revenue: number }[];
  byStaff: { id: number; full_name: string; paid_orders: number; revenue: number }[];
  byTable: { id: number; code: string; name: string; paid_orders: number; revenue: number }[];
  byBranch: { id: number; name: string; paid_orders: number; revenue: number }[];
  byDiscount: { code: string; orders: number; discount: number }[];
  topDishes: { name: string; quantity: number; revenue: number }[];
  totals: { orders: number; revenue: number; discount: number; items: number; avg_order: number };
  funnel: { paid: number; cancelled: number; open: number };
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
  // Khung giờ đông nhất — đưa lên đầu để biểu đồ không chỉ là hình vẽ
  const peakHour = (() => {
    const best = (r?.byHour ?? []).reduce<{ label: string; value: number; hint?: string } | null>((acc, h) => {
      if (Number(h.orders) <= 0) return acc;
      if (!acc || Number(h.orders) > acc.value) {
        return { label: String(h.hour).padStart(2, '0'), value: Number(h.orders), hint: formatMoney(h.revenue) };
      }
      return acc;
    }, null);
    return best;
  })();

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
          <BranchFilter branchFilter={branchFilter} onChange={setBranchFilter} branches={branches.data ?? []} />
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!r?.daily.length} type="button">
            ⬇ Xuất CSV
          </button>
        </>
      }
      onRefresh={state.reload}
      refreshing={state.loading}
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
              <div className="val">{formatMoney(r.totals.avg_order)}</div>
            </div>
            <div className="s-stat">
              <div className="lbl">Số món đã bán</div>
              <div className="val">{r.totals.items}</div>
            </div>
          </div>

          {/* ---------------- BIỂU ĐỒ ----------------
              Biểu đồ vẽ tay bằng SVG (không thêm thư viện) nên không phụ thuộc
              mạng tải chart.js hay gì; xem Charts.tsx */}
          <div className="s-panel">
            <div className="s-panel-head">
              <h3>📈 Xu hướng doanh thu &amp; số đơn theo ngày</h3>
              <span className="badge">{r.daily.length} ngày có dữ liệu</span>
            </div>
            <div className="s-panel-body">
              <AreaChart
                seriesLabel="Doanh thu"
                secondaryLabel="Số đơn"
                points={[...r.daily]
                  .reverse()
                  .map((d) => ({
                    label: formatDate(d.day),
                    value: Number(d.revenue),
                    hint: `${d.orders} đơn`,
                  }))}
                secondaryPoints={[...r.daily]
                  .reverse()
                  .map((d) => ({ label: formatDate(d.day), value: Number(d.orders) }))}
                format={(n) => formatMoney(n)}
                emptyText="Không có đơn đã thanh toán trong khoảng thời gian này."
              />
            </div>
          </div>

          <div className="row row-stretch">
            <div className="s-panel s-panel-fit-lg">
              <div className="s-panel-head">
                <h3>🕐 Giờ vàng (số đơn theo khung giờ)</h3>
              </div>
              <div className="s-panel-body">
                <BarChart
                  points={[...Array(24).keys()].map((h) => {
                    const hit = r.byHour.find((x) => Number(x.hour) === h);
                    return {
                      label: String(h).padStart(2, '0'),
                      value: hit ? Number(hit.orders) : 0,
                      hint: hit ? formatMoney(hit.revenue) : undefined,
                    };
                  })}
                  height={180}
                  emptyText="Không có dữ liệu theo giờ."
                />
                {peakHour ? (
                  <div className="tiny muted mt-8">
                    🏆 Khung giờ đông nhất: <strong>{peakHour.label}h</strong> ({peakHour.value} đơn
                    {peakHour.hint ? ` · ${peakHour.hint}` : ''}).
                  </div>
                ) : null}
              </div>
            </div>

            <div className="s-panel s-panel-fit-lg">
              <div className="s-panel-head">
                <h3>🍽️ Món bán chạy (số phần đã bán)</h3>
              </div>
              <div className="s-panel-body">
                <HBarChart
                  points={r.topDishes.map((d) => ({
                    label: d.name,
                    value: Number(d.quantity),
                    hint: formatMoney(d.revenue),
                  }))}
                  emptyText="Không có món nào đã bán."
                />
              </div>
            </div>
          </div>

          <div className="row row-stretch">
            <div className="s-panel s-panel-fit">
              <div className="s-panel-head">
                <h3>👨‍🍳 Doanh thu theo nhân viên</h3>
              </div>
              <div className="s-panel-body">
                <HBarChart
                  points={r.byStaff.map((s) => ({
                    label: s.full_name,
                    value: Number(s.revenue),
                    hint: `${s.paid_orders} đơn`,
                  }))}
                  format={(n) => formatMoney(n)}
                  emptyText="Không có dữ liệu."
                />
              </div>
            </div>

            <div className="s-panel s-panel-fit">
              <div className="s-panel-head">
                <h3>🏢 Doanh thu theo cơ sở</h3>
              </div>
              <div className="s-panel-body">
                <DonutChart
                  centerLabel="Tổng doanh thu"
                  points={r.byBranch.map((b) => ({
                    label: b.name,
                    value: Number(b.revenue),
                    hint: `${b.paid_orders} đơn`,
                  }))}
                  format={(n) => formatMoney(n)}
                  emptyText="Không có cơ sở nào phát sinh doanh thu."
                />
              </div>
            </div>
          </div>

          <div className="s-panel">
            <div className="s-panel-head">
              <h3>🎟️ Giảm trừ theo mã (tỷ trọng tiền giảm)</h3>
            </div>
            <div className="s-panel-body">
              {r.byDiscount.length === 0 ? (
                <div className="muted small">Không có mã giảm giá nào được dùng trong khoảng này.</div>
              ) : (
                <DonutChart
                  centerLabel="Tổng giảm"
                  points={r.byDiscount.map((d) => ({
                    label: d.code,
                    value: Number(d.discount),
                    hint: `${d.orders} đơn`,
                  }))}
                  format={(n) => formatMoney(n)}
                />
              )}
            </div>
          </div>

          <div className="row row-stretch">
            <div className="s-panel s-panel-fit">
              <div className="s-panel-head">
                <h3>📋 Trạng thái đơn trong khoảng</h3>
              </div>
              <div className="s-panel-body">
                <DonutChart
                  centerLabel="Tổng đơn"
                  points={[
                    { label: 'Đã thanh toán', value: r.funnel.paid },
                    { label: 'Đang xử lý', value: r.funnel.open },
                    { label: 'Đã huỷ', value: r.funnel.cancelled },
                  ].filter((p) => p.value > 0)}
                  format={(n) => String(n)}
                  emptyText="Không có đơn nào trong khoảng thời gian này."
                />
                {r.funnel.open > 0 ? (
                  <div className="tiny muted mt-8">
                    ℹ️ Có <strong>{r.funnel.open}</strong> đơn chưa thanh toán (chờ xác nhận / phục vụ / chờ thu
                    tiền).
                  </div>
                ) : null}
              </div>
            </div>

            <div className="s-panel s-panel-fit">
              <div className="s-panel-head">
                <h3>🪑 Doanh thu theo bàn (top 10)</h3>
              </div>
              <div className="s-panel-body">
                <HBarChart
                  points={r.byTable.slice(0, 10).map((t) => ({
                    label: `${t.code} · ${t.name}`,
                    value: Number(t.revenue),
                    hint: `${t.paid_orders} đơn`,
                  }))}
                  format={(n) => formatMoney(n)}
                  emptyText="Không có dữ liệu."
                />
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="s-panel s-panel-fit">
              <div className="s-panel-head">
                <h3>👨‍🍳 Theo nhân viên thanh toán</h3>
              </div>
              <div className="s-panel-body flush">
                {r.byStaff.length === 0 ? (
                  <div className="muted small pad-17">
                    Không có dữ liệu.
                  </div>
                ) : (
                  <table className="tbl minw-0">
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

            <div className="s-panel s-panel-fit">
              <div className="s-panel-head">
                <h3>🪑 Theo bàn</h3>
              </div>
              <div className="s-panel-body flush">
                {r.byTable.length === 0 ? (
                  <div className="muted small pad-17">
                    Không có dữ liệu.
                  </div>
                ) : (
                  <table className="tbl minw-0">
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
            <div className="s-panel mt-18">
              <div className="s-panel-head">
                <h3>🎟️ Theo mã giảm giá</h3>
                <span className="badge">{r.byDiscount.length} mã</span>
              </div>
              <div className="s-panel-body flush">
                <div className="table-wrap flush">
                  <table className="tbl minw-0">
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
                          <td className="right strong danger-text">
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
