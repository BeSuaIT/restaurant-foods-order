import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { initials } from '../lib/format';
import { tokenStore } from '../lib/http';
import { useAsync } from '../hooks/useAsync';
import { useLiveStream } from '../hooks/useLiveStream';
import { useStaffAuth } from '../hooks/useStaffAuth';
import { useToast } from './Toast';
import { useAnnouncementBadge } from './announcements';
import { AnnouncementPopup } from './AnnouncementPopup';
import type { DashboardStats, StaffUser } from '../types';

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  /** Số đếm hiện trên item: pending = đơn chờ xác nhận, unpaid = hoá đơn chờ thu, draft = đơn chưa order, notif = thông báo chưa đọc */
  badge?: 'pending' | 'unpaid' | 'draft' | 'notif';
}

interface Props {
  role: 'admin' | 'staff';
  sections: { title: string; items: NavItem[] }[];
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Ẩn sidebar (trang in bill) */
  bare?: boolean;
}

/**
 * Khung giao diện dùng chung cho màn hình Nhân viên và Admin.
 * Sidebar điều hướng khác nhau theo role; đây là nơi thực thi
 * yêu cầu "chỉ Admin mới thấy quản lý tài khoản / món ăn / bàn QR / lịch sử order".
 */
export function AppLayout({ role, sections, children, title, subtitle, actions, bare }: Props) {
  const { user, ready, logout } = useStaffAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState(false);

  // Chặn truy cập sai khu vực ngay từ giao diện.
  // Admin được quyền của nhân viên nên vẫn vào được khu vực Vận hành.
  useEffect(() => {
    if (ready && user && user.role !== role && !(role === 'staff' && user.role === 'admin')) {
      toast.error(
        user.role === 'admin'
          ? 'Tài khoản Admin cần đăng nhập tại màn hình Quản trị.'
          : 'Tài khoản nhân viên không vào được khu vực Quản trị.',
      );
      nav(user.role === 'admin' ? '/admin' : '/staff', { replace: true });
    }
  }, [ready, user, role, nav, toast]);

  useEffect(() => setOpen(false), [loc.pathname]);

  const stats = useAsync<DashboardStats>(
    (signal) =>
      fetch('/api/staff/stats', {
        headers: {
          Authorization: `Bearer ${tokenStore.getStaffToken() ?? ''}`,
        },
        signal,
      })
        .then(async (r) => {
          const j = (await r.json()) as { data?: DashboardStats };
          if (!r.ok) throw new Error('Không tải được số liệu');
          return j.data as DashboardStats;
        }),
    [role],
  );

  useLiveStream(tokenStore.getStaffToken(), (e) => {
    setLive(true);
    if (e.type.startsWith('order.') || e.type === 'menu.updated' || e.type === 'table.updated') {
      stats.reload();
    }
    // Admin đăng thông báo mới -> làm mới số đếm chưa đọc
    if (e.type === 'announcement.updated') reloadNotif();
  });

  const pending = stats.data?.counts.pending ?? 0;
  const unpaid = (stats.data?.counts.confirmed ?? 0) + (stats.data?.counts.served ?? 0);
  const drafts = stats.data?.counts.draft ?? 0;

  // Số thông báo chưa đọc — dùng chung context với trang "Thông báo".
  const { unread: notifUnread, reload: reloadNotif } = useAnnouncementBadge();

  const badgeValue = (b?: NavItem['badge']) =>
    b === 'pending'
      ? pending
      : b === 'unpaid'
        ? unpaid
        : b === 'draft'
          ? drafts
          : b === 'notif'
            ? notifUnread
            : 0;

  if (bare) return <>{children}</>;

  if (!ready) return <div className="loading-box">Đang kiểm tra phiên đăng nhập...</div>;

  if (!user) {
    // Chưa đăng nhập -> chuyển tới login kèm đường dẫn quay lại
    return <RedirectToLogin role={role} />;
  }

  const doLogout = () => {
    logout();
    toast.info('Đã đăng xuất.');
    nav('/', { replace: true });
  };

  return (
    <div className="s-shell">
      {open ? <div className="s-backdrop no-print" onClick={() => setOpen(false)} /> : null}

      <aside className={`s-sidebar no-print ${open ? 'open' : ''}`}>
        <div className="s-brand">
          <div className="logo">🍜</div>
          <div className="grow">
            <div className="name">{role === 'admin' ? 'Quản trị' : 'Nhà hàng'}</div>
            <div className="role">{role === 'admin' ? 'Admin' : 'Nhân viên'}</div>
          </div>
        </div>

        <nav className="s-nav">
          {sections.map((sec) => (
            <div key={sec.title}>
              <div className="s-nav-section">{sec.title}</div>
              {sec.items.map((it) => {
                const n = badgeValue(it.badge);
                return (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    end={it.end}
                    className={({ isActive }) => `s-nav-link ${isActive ? 'active' : ''}`}
                  >
                    <span className="ico" aria-hidden>
                      {it.icon}
                    </span>
                    <span className="grow truncate" title={it.label}>
                      {it.label}
                    </span>
                    {n > 0 ? <span className={`count ${it.badge === 'pending' ? 'hot' : ''}`}>{n}</span> : null}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="s-sidebar-foot">
          <div className="s-user-chip">
            <div className="s-avatar">{initials(user.full_name)}</div>
            <div className="info">
              <div className="nm" title={user.full_name}>
                {user.full_name}
              </div>
              <div className="rl">
                {user.role === 'admin'
                  ? 'Quản trị viên'
                  : `Nhân viên · ${user.branch_name ?? 'chưa gán cơ sở'}`}
              </div>
            </div>
            <button className="s-logout" onClick={doLogout} title="Đăng xuất" type="button">
              ⏻
            </button>
          </div>
        </div>
      </aside>

      <div className="s-main">
        <header className="s-topbar no-print">
          <div className="row gap-12">
            <button className="s-menu-toggle" onClick={() => setOpen((o) => !o)} aria-label="Menu" type="button">
              ☰
            </button>
            <div className="s-page-title">
              <h1>{title}</h1>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
          </div>
          <div className="row gap-12">
            {actions}
            <span className={`s-live ${live ? 'on' : ''}`} title={live ? 'Đang kết nối thời gian thực' : 'Đang kết nối...'}>
              <span className="dot" />
              {live ? 'Trực tiếp' : '...'}
            </span>
          </div>
        </header>

        <div className="s-content">{children}</div>
      </div>

      {/* Popup thông báo mới: chỉ hiện 1 lần mỗi lần đăng nhập (xem AnnouncementPopup) */}
      {!bare ? <AnnouncementPopup /> : null}
    </div>
  );
}

/** Nếu chưa đăng nhập thì chuyển tới trang login tương ứng */
function RedirectToLogin({ role }: { role: 'admin' | 'staff' }) {
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    nav(`${role === 'admin' ? '/admin' : '/staff'}/login?next=${encodeURIComponent(loc.pathname)}`, {
      replace: true,
    });
  }, [nav, role, loc.pathname]);
  return <div className="loading-box">Chuyển tới trang đăng nhập...</div>;
}

/* ------------------------------------------------------------------ *
 *  Cấu hình menu theo role
 * ------------------------------------------------------------------ */

export const STAFF_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Vận hành',
    items: [
      { to: '/staff/orders', label: 'Danh sách Order', icon: '📋', badge: 'pending' },
      { to: '/staff/payments', label: 'Hóa đơn chưa thanh toán', icon: '💳', badge: 'unpaid' },
      { to: '/staff/tables', label: 'Bàn đang phục vụ', icon: '🪑' },
      { to: '/staff/notifications', label: 'Thông báo', icon: '📢', badge: 'notif' },
    ],
  },
  {
    title: 'Khác',
    items: [
      { to: '/', label: 'Xem giao diện khách', icon: '📱' },
      { to: '/staff/login', label: 'Đổi tài khoản', icon: '🔑' },
    ],
  },
];

export const ADMIN_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Tổng quan',
    items: [
      { to: '/admin', label: 'Bảng điều khiển', icon: '📊', end: true },
      { to: '/admin/reports', label: 'Báo cáo doanh thu', icon: '📈' },
    ],
  },
  {
    title: 'Vận hành (Admin cũng nhận order)',
    items: [
      { to: '/staff/orders', label: 'Danh sách Order', icon: '📋', badge: 'pending' },
      { to: '/staff/payments', label: 'Hóa đơn chưa thanh toán', icon: '💳', badge: 'unpaid' },
      { to: '/staff/tables', label: 'Bàn đang phục vụ', icon: '🪑' },
      { to: '/staff/notifications', label: 'Thông báo', icon: '📢', badge: 'notif' },
    ],
  },
  {
    title: 'Quản lý (chỉ Admin)',
    items: [
      { to: '/admin/users', label: 'Quản lý tài khoản', icon: '👥' },
      { to: '/admin/dishes', label: 'Quản lý món ăn', icon: '🍽️' },
      { to: '/admin/option-groups', label: 'Phần chọn đi kèm', icon: '⚙️' },
      { to: '/admin/tables', label: 'Quản lý bàn & mã QR', icon: '📱' },
      { to: '/admin/discount-codes', label: 'Mã giảm giá', icon: '🎟️' },
      { to: '/admin/announcements', label: 'Thông báo nội bộ', icon: '📣' },
      { to: '/admin/history', label: 'Lịch sử order', icon: '🧾' },
      { to: '/admin/settings', label: 'Cài đặt cơ sở', icon: '🏢' },
    ],
  },
];
