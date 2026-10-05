import { useMemo } from 'react';
import { formatPercent } from '../lib/format';

/* ================================================================== *
 *  BIỂU ĐỒ SVG (không dùng thư viện)
 *
 *  Vẽ tay bằng SVG để không phải thêm dependency (~100kb) chỉ để hiển thị
 *  vài biểu đồ trong màn báo cáo. Giao diện dùng chung với phần còn lại:
 *  màu thương hiệu, bo góc, chữ nhỏ.
 * ================================================================== */

const BRAND = 'var(--brand)';
const ORANGE = '#fb923c';

export interface SeriesPoint {
  label: string;
  value: number;
  /** Ghi chú phụ hiển thị khi rê chuột (VD: số đơn) */
  hint?: string;
}

interface BaseProps {
  points: SeriesPoint[];
  height?: number;
  /** Định dạng giá trị trên trục/tooltip */
  format?: (n: number) => string;
  emptyText?: string;
}

/* ------------------------------------------------------------------ *
 *  Cột dọc (bar) — dùng cho "theo nhân viên", "theo bàn", "món bán chạy"
 * ------------------------------------------------------------------ */
export function BarChart({ points, height = 190, format = (n) => String(n), emptyText }: BaseProps) {
  const max = Math.max(1, ...points.map((p) => p.value));

  if (points.length === 0) {
    return <div className="chart-empty">{emptyText ?? 'Không có dữ liệu.'}</div>;
  }

  /* Nhiều cột thì không đủ bề ngang để hiện số và nhãn mọi cột:
     số bị cắt thành "…8", nhãn ngày chồng lên nhau. Khi đó chỉ hiện nhãn theo bước,
     số thì đọc qua tooltip (title) trên cả cột. */
  const showValues = points.length <= 8;
  const labelStep = Math.ceil(points.length / 10);

  return (
    <div className="chart chart-bars" style={{ minHeight: height }}>
      {points.map((p, i) => {
        const pct = Math.max(1.5, (p.value / max) * 100);
        return (
          <div className="chart-bar-wrap" key={p.label} title={`${p.label}: ${format(p.value)}${p.hint ? ` — ${p.hint}` : ''}`}>
            {showValues ? <div className="chart-bar-value">{format(p.value)}</div> : <div className="chart-bar-value chart-bar-value-off" />}
            <div className="chart-bar-track">
              <div className="chart-bar-fill" style={{ height: `${pct}%` }} />
            </div>
            <div className="chart-bar-label">{showValues || i % labelStep === 0 ? p.label : ''}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Cột ngang (hbar) — nhãn dài (tên món, tên nhân viên)
 * ------------------------------------------------------------------ */
export function HBarChart({ points, format = (n) => String(n), emptyText }: BaseProps) {
  const max = Math.max(1, ...points.map((p) => p.value));

  if (points.length === 0) {
    return <div className="chart-empty">{emptyText ?? 'Không có dữ liệu.'}</div>;
  }

  return (
    <div className="chart chart-hbars">
      {points.map((p) => (
        <div className="chart-hbar" key={p.label}>
          <div className="chart-hbar-name truncate" title={p.label}>
            {p.label}
          </div>
          <div className="chart-hbar-track">
            <div className="chart-hbar-fill" style={{ width: `${Math.max(1.5, (p.value / max) * 100)}%` }} />
          </div>
          <div className="chart-hbar-value">{format(p.value)}</div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Biểu đồ vùng + đường (area/line) — chuỗi thời gian
 * ------------------------------------------------------------------ */
export function AreaChart({
  points,
  height = 210,
  format = (n) => String(n),
  emptyText,
  seriesLabel = 'Doanh thu',
  secondaryPoints,
  secondaryLabel = 'Số đơn',
  formatSecondary = (n) => String(n),
}: BaseProps & {
  seriesLabel?: string;
  secondaryPoints?: SeriesPoint[];
  secondaryLabel?: string;
  formatSecondary?: (n: number) => string;
}) {
  const W = 760;
  const H = height;
  const padL = 54;
  const padR = secondaryPoints ? 40 : 12;
  const padT = 12;
  const padB = 30;

  const max = Math.max(1, ...points.map((p) => p.value));
  // Làm tròn "đẹp" lên bậc 10^n để trục Y có nhãn dễ đọc
  const niceMax = useMemo(() => niceCeil(max), [max]);

  if (points.length === 0) {
    return <div className="chart-empty">{emptyText ?? 'Không có dữ liệu trong khoảng thời gian này.'}</div>;
  }

  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;

  const x = (i: number) => padL + (points.length > 1 ? i * stepX : innerW / 2);
  const y = (v: number) => padT + innerH - (v / niceMax) * innerH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(points.length - 1).toFixed(1)} ${(padT + innerH).toFixed(1)} L ${x(0).toFixed(1)} ${(
    padT + innerH
  ).toFixed(1)} Z`;

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((f) => niceMax * f);

  // chỉ hiện nhãn X ở khoảng 6 mốc để không chồng chữ
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  const secMax = Math.max(1, ...(secondaryPoints ?? []).map((p) => p.value));
  const secLine = (secondaryPoints ?? [])
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${(padT + innerH - (p.value / secMax) * innerH).toFixed(1)}`)
    .join(' ');

  return (
    <div className="chart chart-svg-wrap">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Biểu đồ ${seriesLabel} theo thời gian`}
      >
        <defs>
          <linearGradient id="chartAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND} stopOpacity="0.34" />
            <stop offset="100%" stopColor={BRAND} stopOpacity="0.03" />
          </linearGradient>
        </defs>

        {/* lưới ngang + nhãn trục Y */}
        {gridValues.map((v, i) => (
          <g key={i}>
            <line
              x1={padL}
              y1={y(v)}
              x2={W - padR}
              y2={y(v)}
              stroke="var(--line)"
              strokeDasharray={i === 0 ? undefined : '4 4'}
            />
            <text x={padL - 7} y={y(v) + 4} textAnchor="end" className="chart-axis-text">
              {format(v)}
            </text>
          </g>
        ))}

        {/* trục Y phụ cho số đơn */}
        {secondaryPoints
          ? [0, 0.5, 1].map((f, i) => (
              <text
                key={i}
                x={W - padR + 6}
                y={padT + innerH - f * innerH + 4}
                textAnchor="start"
                className="chart-axis-text"
              >
                {formatSecondary(secMax * f)}
              </text>
            ))
          : null}

        <path d={area} fill="url(#chartAreaFill)" />
        <path d={line} fill="none" stroke={BRAND} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        {secondaryPoints && secLine ? (
          <path
            d={secLine}
            fill="none"
            stroke={ORANGE}
            strokeWidth={1.8}
            strokeDasharray="5 3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}

        {/* chấm dữ liệu */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.value)}
            r={points.length > 45 ? 1.8 : 3}
            fill="#fff"
            stroke={BRAND}
            strokeWidth={1.8}
          >
            <title>{`${p.label}: ${format(p.value)}${p.hint ? ` — ${p.hint}` : ''}`}</title>
          </circle>
        ))}

        {/* nhãn trục X */}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={i} x={x(i)} y={H - 9} textAnchor="middle" className="chart-axis-text">
              {p.label}
            </text>
          ) : null,
        )}
      </svg>

      <div className="chart-legend">
        <span className="chart-legend-item">
          <i style={{ background: BRAND }} /> {seriesLabel}
        </span>
        {secondaryPoints ? (
          <span className="chart-legend-item">
            <i style={{ background: ORANGE }} /> {secondaryLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Làm tròn lên bậc 10 / 100 / 1000... cho trục dễ đọc. */
function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(n));
  const norm = n / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/* ------------------------------------------------------------------ *
 *  Biểu đồ tròn (donut) — tỷ trọng
 * ------------------------------------------------------------------ */
const DONUT_COLORS = ['#e8590c', '#f59e0b', '#0ea5e9', '#16a34a', '#8b5cf6', '#64748b'];

export function DonutChart({
  points,
  format = (n) => String(n),
  centerLabel = 'Tổng',
  emptyText,
}: BaseProps & { centerLabel?: string }) {
  const total = points.reduce((s, p) => s + p.value, 0);
  const R = 68;
  const C = 2 * Math.PI * R;

  if (total <= 0 || points.length === 0) {
    return <div className="chart-empty">{emptyText ?? 'Không có dữ liệu.'}</div>;
  }

  let offset = 0;

  return (
    <div className="chart chart-donut">
      <svg className="chart-donut-svg" viewBox="0 0 180 180" role="img" aria-label={`Biểu đồ tỷ trọng ${centerLabel}`}>
        <g transform="translate(90,90) rotate(-90)">
          <circle r={R} fill="none" stroke="var(--muted-bg)" strokeWidth={26} />
          {points.map((p, i) => {
            const frac = p.value / total;
            const dash = frac * C;
            const el = (
              <circle
                key={p.label}
                r={R}
                fill="none"
                stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
                strokeWidth={26}
                strokeDasharray={`${Math.max(0, dash - 2)} ${C - Math.max(0, dash - 2)}`}
                strokeDashoffset={-offset}
              >
                <title>{`${p.label}: ${format(p.value)} (${formatPercent(frac * 100)})`}</title>
              </circle>
            );
            offset += dash;
            return el;
          })}
        </g>
        <text x="90" y="86" textAnchor="middle" className="chart-donut-total">
          {format(total)}
        </text>
        <text x="90" y="105" textAnchor="middle" className="chart-donut-label">
          {centerLabel}
        </text>
      </svg>

      <div className="chart-donut-legend">
        {points.map((p, i) => (
          <div className="chart-legend-item" key={p.label} title={`${format(p.value)} (${formatPercent((p.value / total) * 100)})`}>
            <i style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
            <span className="truncate">{p.label}</span>
            <strong>{formatPercent((p.value / total) * 100)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}