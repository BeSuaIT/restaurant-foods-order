import { useEffect, useState } from 'react';
import { api, formatDateTime, timeAgo, tokenStore, useAsync, useLiveStream, useStaffAuth } from '../../api';
import { STAFF_SECTIONS, ADMIN_SECTIONS, AppLayout } from '../../components/AppLayout';
import { RichView } from '../../components/RichText';
import { useAnnouncementBadge } from '../../components/announcements';
import { useToast } from '../../components/Toast';
import type { AnnouncementWithRead } from '../../types';

/* ================================================================== *
 *  THÔNG BÁO NỘI BỘ (phía nhân viên)
 *
 *  Mỗi thông báo được trình bày như một bài viết: tiêu đề, nội dung định dạng,
 *  hình ảnh, người gửi và thời gian đăng. Thông báo chưa đọc được đánh dấu
 *  đậm + badge "Mới"; bấm vào là đánh dấu đã đọc.
 * ================================================================== */

interface ListResponse {
  rows: AnnouncementWithRead[];
  unread_count: number;
}

export function StaffNotifications() {
  const toast = useToast();
  const { user } = useStaffAuth();
  const { setUnread, reload: reloadBadge } = useAnnouncementBadge();
  const [opened, setOpened] = useState<number | null>(null);

  const state = useAsync<ListResponse>(
    (signal) => api.get<ListResponse>('/staff/announcements', { signal }),
    [],
  );

  const unread = state.data?.unread_count ?? 0;

  // Đồng bộ số chưa đọc lên badge trên sidebar (chỉ khi đã tải xong, tránh
  // ghi đè con số đúng của provider bằng giá trị 0 lúc đang loading).
  useEffect(() => {
    if (state.data) setUnread(unread);
  }, [state.data, unread, setUnread]);

  // Có thông báo mới trong lúc đang mở trang -> tự tải lại
  useLiveStream(tokenStore.getStaffToken(), (e) => {
    if (e.type === 'announcement.updated') {
      state.reload();
      reloadBadge();
    }
  });

  const markRead = async (a: AnnouncementWithRead) => {
    setOpened(a.id);
    if (a.is_read) return;
    try {
      const res = await api.post<{ unread_count: number }>(`/staff/announcements/${a.id}/read`);
      state.setData((prev) =>
        prev
          ? {
              ...prev,
              unread_count: res.unread_count,
              rows: prev.rows.map((r) => (r.id === a.id ? { ...r, is_read: true } : r)),
            }
          : prev,
      );
    } catch {
      /* bỏ qua: lần sau mở lại trang sẽ đồng bộ lại */
    }
  };

  const markAll = async () => {
    try {
      await api.post('/staff/announcements/read-all');
      state.setData((prev) =>
        prev ? { ...prev, unread_count: 0, rows: prev.rows.map((r) => ({ ...r, is_read: true })) } : prev,
      );
      toast.success('Đã đánh dấu đọc tất cả thông báo.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không cập nhật được.');
    }
  };

  const rows = state.data?.rows ?? [];

  return (
    <AppLayout
      role="staff"
      sections={user?.role === 'admin' ? ADMIN_SECTIONS : STAFF_SECTIONS}
      title="Thông báo"
      subtitle={
        rows.length === 0
          ? 'Chưa có thông báo nào'
          : `${rows.length} thông báo${unread > 0 ? ` · ${unread} chưa đọc` : ' · đã đọc hết'}`
      }
      actions={
        unread > 0 ? (
          <button className="btn btn-secondary btn-sm" onClick={() => void markAll()} type="button">
            ✓ Đã đọc tất cả
          </button>
        ) : null
      }
    >
      {state.loading ? (
        <div className="loading-box">Đang tải thông báo...</div>
      ) : state.error ? (
        <div className="alert alert-error">{state.error}</div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <div className="icon">📢</div>
          <div className="strong">Chưa có thông báo nào</div>
          <div className="small">
            Khi Admin đăng thông báo mới (sự kiện, thay đổi lịch, sự cố...) bạn sẽ thấy ở đây.
          </div>
        </div>
      ) : (
        <div className="note-list">
          {rows.map((a) => (
            <article className={`note ${a.is_read ? '' : 'unread'}`} key={a.id}>
              <button className="note-head" onClick={() => void markRead(a)} type="button">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="note-title">
                    {a.title}
                    {a.is_read ? null : <span className="badge badge-danger note-new">Mới</span>}
                  </div>
                  <div className="tiny muted">
                    📢 {a.created_by_name ?? 'Admin'} · {timeAgo(a.published_at)} ·{' '}
                    {formatDateTime(a.published_at)}
                  </div>
                </div>
                <span className="note-caret">{opened === a.id ? '▲' : '▼'}</span>
              </button>

              {a.image_url ? (
                <img className="note-img" src={a.image_url} alt={a.title} loading="lazy" />
              ) : null}

              {opened === a.id ? (
                <RichView html={a.content} className="note-body" />
              ) : (
                <div className="note-excerpt">{plainText(a.content).slice(0, 160)}</div>
              )}
            </article>
          ))}
        </div>
      )}
    </AppLayout>
  );
}

/** Xoá thẻ để lấy đoạn trích thuần khi thông báo đang thu gọn. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

