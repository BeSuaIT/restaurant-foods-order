/* ------------------------------------------------------------------ *
 *  Định dạng hiển thị — toàn bộ dùng quy ước Việt Nam (vi-VN)
 *  Nhất quán ở đây để không xuất hiện "89.4%" lẫn "89,4%".
 * ------------------------------------------------------------------ */

const VND = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const DEC1 = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const formatMoney = (n: number | string | null | undefined): string => {
  const v = Number(n ?? 0);
  return VND.format(Number.isFinite(v) ? v : 0) + 'đ';
};

export const formatMoneyPlain = (n: number | string | null | undefined): string => {
  const v = Number(n ?? 0);
  return VND.format(Number.isFinite(v) ? v : 0);
};

/** Số phần trăm 1 chữ số thập phân, dấu phẩy kiểu Việt: 89,4% */
export const formatPercent = (n: number | string | null | undefined): string => {
  const v = Number(n ?? 0);
  return DEC1.format(Number.isFinite(v) ? v : 0) + '%';
};

const COORD = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/**
 * Toạ độ: dấu phẩy kiểu Việt, tối đa 3 chữ số thập phân (~111m — dư cho vị trí
 * một quán). Trước đây hiện số thô `toFixed(6)` = "10.776933": sai dấu thập phân
 * theo Việt và quá nhiều chữ số vô nghĩa đọc trên màn hình.
 * Giá trị gửi lên API và link Google Maps vẫn dùng số gốc, không bị làm tròn.
 */
export const formatCoord = (n: number | string | null | undefined): string => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return COORD.format(v);
};

export const formatTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
};

export const formatDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '—';
  const diff = Date.now() - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return formatDate(iso);
}

export function durationBetween(from: string | null, to: string | null): string {
  if (!from) return '—';
  const a = new Date(from).getTime();
  const b = to ? new Date(to).getTime() : Date.now();
  if (Number.isNaN(a) || Number.isNaN(b)) return '—';
  const mins = Math.max(0, Math.round((b - a) / 60000));
  if (mins < 60) return `${mins} phút`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}p` : `${h}h`;
}

export function initials(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
}