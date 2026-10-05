import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDateTime, tokenStore } from '../api';
import { useAnnouncementBadge } from './announcements';
import { RichView } from './RichText';
import type { AnnouncementWithRead } from '../types';

/* ================================================================== *
 *  POPUP THÔNG BÁO MỚI KHI VỪA ĐĂNG NHẬP
 *
 *  Yêu cầu: thông báo mới hiện popup đè lên màn hình đúng 1 lần mỗi lần
 *  nhân viên đăng nhập vào ca. Nếu họ đóng popup mà chưa bấm "Đã đọc" thì
 *  thông báo vẫn nằm trong danh sách (kèm badge chưa đọc) và sẽ hiện lại
 *  ở lần đăng nhập kế tiếp.
 *
 *  Cờ "đã hiện trong phiên này" để trong sessionStorage: đóng tab/mở lại
 *  trong cùng phiên đăng nhập thì không bật lại popup.
 * ================================================================== */

const POPUP_KEY = 'ttth_notif_popup_shown';

interface ListResponse {
  rows: AnnouncementWithRead[];
  unread_count: number;
}

export function AnnouncementPopup() {
  const [target, setTarget] = useState<AnnouncementWithRead | null>(null);
  const { reload } = useAnnouncementBadge();

  useEffect(() => {
    // Đã hiện trong phiên đăng nhập này rồi -> không hiện lại
    if (sessionStorage.getItem(POPUP_KEY) === '1') return;
    if (!tokenStore.getStaffToken()) return;

    let alive = true;
    api
      .get<ListResponse>('/staff/announcements')
      .then((res) => {
        if (!alive) return;
        // Đánh dấu "đã hiện" ngay kể cả khi không có thông báo, để mỗi lần đăng
        // nhập chỉ hỏi server 1 lần thay vì 1 lần mỗi lần đổi trang.
        sessionStorage.setItem(POPUP_KEY, '1');
        const unread = res.rows.filter((a) => !a.is_read);
        if (unread.length === 0) return;
        // ưu tiên thông báo mới nhất chưa đọc
        setTarget(unread[0]);
      })
      .catch(() => undefined);

    return () => {
      alive = false;
    };
  }, []);

  if (!target) return null;

  const close = () => setTarget(null);

  const markRead = async () => {
    try {
      await api.post(`/staff/announcements/${target.id}/read`);
      reload();
    } catch {
      /* không quan trọng: lần sau mở lại trang sẽ đồng bộ */
    }
    close();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal modal-lg" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: 17 }}>📢 {target.title}</h3>
            <div className="tiny muted" style={{ marginTop: 3 }}>
              {target.created_by_name ?? 'Admin'} · {formatDateTime(target.published_at)}
            </div>
          </div>
          <button className="modal-close" onClick={close} aria-label="Đóng" type="button">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {target.image_url ? <img className="note-img" src={target.image_url} alt={target.title} /> : null}
          <RichView html={target.content} className="note-body" />
          <div className="tiny muted" style={{ marginTop: 14 }}>
            Nếu bạn đóng mà chưa bấm "Đã đọc", thông báo này vẫn nằm trong mục Thông báo và sẽ hiện lại ở
            lần đăng nhập kế tiếp.
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={close} type="button">
            Đóng (để sau)
          </button>
          <Link className="btn btn-ghost" to="/staff/notifications" onClick={close}>
            Xem tất cả
          </Link>
          <button className="btn" onClick={() => void markRead()} type="button">
            ✓ Đã đọc
          </button>
        </div>
      </div>
    </div>
  );
}