import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, tokenStore, useAsync } from '../../api';
import type { Branch } from '../../types';

/* ================================================================== *
 *  TRANG IN THẺ QR — /admin/tables/print
 *
 *  Vì sao có trang riêng thay vì in từ modal:
 *  - `@page { size: 80mm }` dùng cho hoá đơn 80mm sẽ ép mọi thẻ QR vào khổ
 *    giấy hẹp, chữ nhỏ và mã QR bị vỡ -> không quét được.
 *  - Modal có `overflow: hidden` + `max-height`, nên khi in ra trình duyệt chỉ
 *    chụp được phần đang nhìn thấy, các thẻ phía dưới bị cắt.
 *
 *  Trang này render thẻ QR ở kích thước thật (45mm), không trong khung modal,
 *  khai báo `@page` riêng và tự gọi window.print() sau khi ảnh QR nạp xong.
 * ================================================================== */

interface QrSheetItem {
  id: number;
  code: string;
  name: string;
  area: string | null;
  seats: number;
  is_active: boolean;
  branch_name: string | null;
  url: string;
  qr: string;
}

export function QrPrintPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const branchId = params.get('branch_id') ?? '';
  const [failed, setFailed] = useState<string[]>([]);

  const branches = useAsync<Branch[]>((signal) => api.get<Branch[]>('/admin/branches', { signal }), []);
  const qs = branchId === '' ? '' : `?branch_id=${encodeURIComponent(branchId)}`;
  const state = useAsync<QrSheetItem[]>(
    (signal) => api.get<QrSheetItem[]>(`/admin/tables/qr-sheet${qs}`, { signal }),
    [qs],
  );

  const sheet = state.data ?? [];

  /**
   * Chỉ gọi print() khi MỌI ảnh QR đã decode xong.
   * Nếu in lúc ảnh còn trắng thì máy in ra thẻ không quét được — đúng cái lỗi
   * "in ra chỉ thấy khung cửa sổ" mà không thấy mã.
   */
  useEffect(() => {
    if (sheet.length === 0) return;
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.qr-print-sheet img'));
    if (imgs.length === 0) return;

    let cancelled = false;
    const decodeAll = async () => {
      setFailed([]);
      await Promise.all(
        imgs.map(async (img) => {
          if (img.complete && img.naturalWidth > 0) return;
          try {
            await img.decode();
          } catch {
            if (!cancelled) {
              setFailed((f) => [...f, img.alt || 'QR']);
              return;
            }
          }
        }),
      );
      if (cancelled) return;
      // thêm chút trễ để trình duyệt kịp vẽ lại sau khi decode
      window.setTimeout(() => {
        if (!cancelled) window.print();
      }, 150);
    };

    void decodeAll();
    return () => {
      cancelled = true;
    };
  }, [sheet.length, state.data]);

  if (!tokenStore.getStaffToken()) {
    return (
      <div className="loading-box">
        Chưa đăng nhập. Quay lại <a href="/admin/tables">trang quản lý bàn</a> và bấm lại nút in.
      </div>
    );
  }

  return (
    <div className="qr-print-root">
      {/* Thanh điều khiển — không in ra */}
      <div className="qr-print-bar no-print">
        <strong>🖨 In thẻ QR</strong>
        <span className="muted small">
          {sheet.length} thẻ
          {branchId === '' ? ' (tất cả cơ sở)' : ` — ${branches.data?.find((b) => String(b.id) === branchId)?.name ?? ''}`}
        </span>
        <span className="grow" />
        <select
          className="input"
          style={{ width: 190, padding: '6px 10px' }}
          value={branchId}
          onChange={(e) => nav(`/admin/tables/print${e.target.value === '' ? '' : `?branch_id=${e.target.value}`}`, { replace: true })}
        >
          <option value="">🏢 Tất cả cơ sở</option>
          {(branches.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              🏢 {b.name}
            </option>
          ))}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={() => nav('/admin/tables')} type="button">
          ← Quay lại
        </button>
        <button
          className="btn btn-sm"
          disabled={state.loading || sheet.length === 0}
          onClick={() => window.print()}
          type="button"
        >
          🖨 In ngay
        </button>
      </div>

      {failed.length > 0 ? (
        <div className="alert alert-warn no-print">
          ⚠️ {failed.length} mã QR không tải được ({failed.slice(0, 5).join(', ')}
          {failed.length > 5 ? '…' : ''}. Thử bấm <strong>In ngay</strong> sau khi mạng ổn định.
        </div>
      ) : null}

      {state.loading ? (
        <div className="loading-box">Đang tải mã QR...</div>
      ) : state.error ? (
        <div className="alert alert-error">{state.error}</div>
      ) : sheet.length === 0 ? (
        <div className="empty">
          <div className="icon">🪑</div>
          <div>Không có bàn nào để in.</div>
        </div>
      ) : (
        <>
          <p className="qr-print-hint no-print">
            Mỗi thẻ in ở khổ <strong>50mm × 70mm</strong>, mỗi hàng <strong>3 thẻ</strong> trên giấy A4
            (tối đa 9 thẻ/trang). Cắt theo đường viền mảnh và dán lên mặt bàn. Nếu máy in không tự mở hộp
            thoại, chọn khổ <strong>A4</strong>, tỉ lệ <strong> 100%</strong>, lề <strong>Không</strong>,
            và bật <strong>Đồ hoạ nền</strong>.
          </p>
          <div className="qr-print-sheet">
            {sheet.map((q) => (
              <div className="qr-print-card" key={q.id}>
                <div className="qr-print-head">
                  <div className="qr-print-name">{q.name}</div>
                  <div className="qr-print-code">{q.code}</div>
                </div>
                <div className="qr-print-meta">
                  {q.branch_name ? `${q.branch_name} · ` : ''}
                  {q.area ?? '—'} · {q.seats} chỗ
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="qr-print-img" src={q.qr} alt={`QR bàn ${q.code}`} width={160} height={160} />
                <div className="qr-print-cta">📱 Quét để gọi món</div>
                {!q.is_active ? <div className="qr-print-off">Bàn đang tạm ngưng</div> : null}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}