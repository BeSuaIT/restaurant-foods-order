import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { api, tokenStore } from '../api';

/* ================================================================== *
 *  SỐ ĐẾM THÔNG BÁO CHƯA ĐỌC
 *
 *  Sidebar (AppLayout) và trang "Thông báo" cùng cần biết con số này. Dùng
 *  context nhỏ để chỉ gọi API 1 lần, mọi nơi cùng đọc.
 * ================================================================== */

interface AnnouncementBadgeValue {
  unread: number;
  setUnread: (n: number) => void;
  reload: () => void;
}

const AnnouncementBadgeContext = createContext<AnnouncementBadgeValue>({
  unread: 0,
  setUnread: () => undefined,
  reload: () => undefined,
});

export function AnnouncementBadgeProvider({ children }: { children: ReactNode }) {
  const [unread, setUnread] = useState(0);
  // token đang đăng nhập — dùng làm khoá để nạp lại khi đổi tài khoản
  const [token, setToken] = useState<string | null>(() => tokenStore.getStaffToken());

  const reload = useCallback((t: string | null) => {
    if (!t) {
      setUnread(0);
      return;
    }
    api
      .get<{ unread_count: number }>('/staff/announcements/unread-count', { staffToken: t })
      .then((r) => setUnread(Number(r.unread_count ?? 0)))
      .catch(() => undefined);
  }, []);

  // Theo dõi token đăng nhập. Provider này nằm TRÊN <Routes> nên nó không được
  // remount khi đăng nhập/đăng xuất (SPA điều hướng, không tải lại trang) —
  // vì vậy phải đọc lại token mỗi khi đường dẫn đổi, nếu không badge sẽ luôn 0
  // sau lúc vừa đăng nhập.
  const loc = useLocation();
  useEffect(() => {
    const t = tokenStore.getStaffToken();
    if (t !== token) setToken(t);
    reload(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname, reload]);

  useEffect(() => {
    if (!token) return;
    // Nạp lại mỗi khi mở tab mới / quay lại trang (đồng bộ badge số)
    const onFocus = () => reload(token);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [token, reload]);

  const value = useMemo<AnnouncementBadgeValue>(
    () => ({ unread, setUnread, reload: () => reload(token) }),
    [unread, reload, token],
  );

  return <AnnouncementBadgeContext.Provider value={value}>{children}</AnnouncementBadgeContext.Provider>;
}

export function useAnnouncementBadge(): AnnouncementBadgeValue {
  return useContext(AnnouncementBadgeContext);
}