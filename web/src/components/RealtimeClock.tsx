import { useEffect, useState } from 'react';
import { elapsedClock } from '../lib/format';

/* ================================================================== *
 *  ĐỒNG HỒ REALTIME
 *
 *  Đếm thời gian từ một mốc (khách bắt đầu order, bếp nhận đơn...) và
 *  tự chạy mỗi giây. Màu đổi theo mức gấp: 10 phút là vàng, 20 phút
 *  là đỏ — để phục vụ nhìn thấy đơn nào đang chậm.
 * ================================================================== */

/** ngưỡng phút → mức cảnh báo. */
const WARN_MIN = 10;
const DANGER_MIN = 20;

export function RealtimeClock({
  from,
  label,
  prefix = '⏱',
}: {
  from: string | null;
  label?: string;
  prefix?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Cứ 1s dựng lại: số phút làm tròn nên đồng hồ phải tự nhảy từng giây
    // mới thấy chạy. 1s là đủ mượt và không tốn kém gì.
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const mins = from ? Math.max(0, Math.floor((now - new Date(from).getTime()) / 60000)) : 0;
  const tone = mins >= DANGER_MIN ? 'danger' : mins >= WARN_MIN ? 'warn' : '';

  return (
    <span className={`live-clock ${tone}`} title={label ?? 'Thời gian đã trôi qua'}>
      <span className="lc-prefix" aria-hidden>
        {prefix}
      </span>
      <span className="lc-val mono">{elapsedClock(from, now)}</span>
      {label ? <span className="lc-label">{label}</span> : null}
    </span>
  );
}
