import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { initials } from '../lib/format';
import { api, tokenStore } from '../lib/http';
import { useAsync } from '../hooks/useAsync';
import { useLiveStream } from '../hooks/useLiveStream';
import { useStaffAuth } from '../hooks/useStaffAuth';
import { useToast } from './Toast';
import { ACTIVE_ORDER_STATUSES, ROLE_LABEL, type DashboardStats, type UserRole } from '../types';

/** Tên/icon hiển thị ở đầu sidebar theo khu vực đang đăng nhập. */
const BRAND_NAME: Record<UserRole, string> = {
  admin: 'Quản trị',
  staff: 'Nhà hàng',
  kitchen: 'Bếp',
};
const BRAND_ICON: Record<UserRole, string> = {
  admin: '🍜',
  staff: '🍜',
  kitchen: '🍳',
};

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  /** Số đếm hiện trên item: pending = đơn chờ nhận, unpaid = hoá đơn chờ thu, draft = đơn chưa order, kitchenNew = đơn chờ bếp nhận */
  badge?: 'pending' | 'unpaid' | 'draft' | 'kitchenNew';
}

interface Props {
  role: UserRole;
  sections: { title: string; items: NavItem[] }[];
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Ẩn sidebar (trang in bill) */
  bare?: boolean;
  /** Gọi lại dữ liệu trang khi bấm nút làm mới ở thanh trên cùng. */
  onRefresh?: () => void;
  /** Đang tải lại — nút làm mới hiện vòng quay. */
  refreshing?: boolean;
}

/**
 * Khung giao diện dùng chung cho màn hình Nhân viên và Admin.
 * Sidebar điều hướng khác nhau theo role; đây là nơi thực thi
 * yêu cầu "chỉ Admin mới thấy quản lý tài khoản / món ăn / bàn QR / lịch sử order".
 */
export function AppLayout({
  role,
  sections,
  children,
  title,
  subtitle,
  actions,
  bare,
  onRefresh,
  refreshing,
}: Props) {
  const { user, ready, logout } = useStaffAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState(false);

  // Chặn truy cập sai khu vực ngay từ giao diện.
  // Admin được quyền của phục vụ bàn nên vẫn vào được khu vực Vận hành.
  // Phục vụ bếp là một khu riêng, không lẫn vào 2 khu kia.
  useEffect(() => {
    if (!ready || !user) return;
    const allowed =
      user.role === role ||
      (role === 'staff' && user.role === 'admin');
    if (allowed) return;

    const home: string =
      user.role === 'admin' ? '/admin' : user.role === 'kitchen' ? '/kitchen' : '/staff';
    toast.error(
      user.role === 'admin'
        ? 'Tài khoản Admin cần đăng nhập tại màn hình Quản trị.'
        : user.role === 'kitchen'
          ? 'Tài khoản phục vụ bếp không vào được khu vực này.'
          : 'Tài khoản phục vụ bàn không vào được khu vực Quản trị.',
    );
    nav(home, { replace: true });
  }, [ready, user, role, nav, toast]);

  useEffect(() => setOpen(false), [loc.pathname]);

  // Bếp không có quyền trên /api/staff nên thống kê của bếp lấy ở /api/kitchen.
  const statsPath = role === 'kitchen' ? '/api/kitchen/stats' : '/api/staff/stats';

  const stats = useAsync<DashboardStats>(
    (signal) =>
      fetch(statsPath, {
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
    [role, statsPath],
  );

  useLiveStream(tokenStore.getStaffToken(), (e) => {
    setLive(true);
    if (e.type.startsWith('order.') || e.type === 'menu.updated' || e.type === 'table.updated') {
      stats.reload();
    }
  });

  const pending = stats.data?.counts.pending ?? 0;
  // Mọi đơn còn chạy đều là hoá địn chờ thu, kể cả đơn đang ở bếp.
  const unpaid = useMemo(
    () =>
      (stats.data ? ACTIVE_ORDER_STATUSES : [])
        .filter((s) => s !== 'pending')
        .reduce((sum, s) => sum + (stats.data?.counts[s] ?? 0), 0),
    [stats.data],
  );
  const drafts = stats.data?.counts.draft ?? 0;
  // Đơn bếp vừa nhận được, chờ bếp bấm "Nhận đơn".
  const kitchenNew = stats.data?.counts.sent_kitchen ?? 0;

  const badgeValue = (b?: NavItem['badge']) =>
    b === 'pending'
      ? pending
      : b === 'unpaid'
        ? unpaid
        : b === 'draft'
          ? drafts
          : b === 'kitchenNew'
            ? kitchenNew
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
          <div className="logo">{BRAND_ICON[role]}</div>
          <div className="grow">
            <div className="name">{BRAND_NAME[role]}</div>
            <div className="role">{ROLE_LABEL[role]}</div>
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
                  : `${ROLE_LABEL[user.role]} · ${user.branch_name ?? 'chưa gán cơ sở'}`}
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
            {onRefresh ? (
              <button
                className="btn btn-secondary btn-sm"
                onClick={onRefresh}
                disabled={refreshing}
                title="Tải lại dữ liệu của trang này"
                type="button"
              >
                <span className={refreshing ? 'spinner' : undefined} aria-hidden />
                {refreshing ? 'Đang tải...' : 'Làm mới'}
              </button>
            ) : null}
            <span className={`s-live ${live ? 'on' : ''}`} title={live ? 'Đang kết nối thời gian thực' : 'Đang kết nối...'}>
              <span className="dot" />
              {live ? 'Trực tiếp' : '...'}
            </span>
          </div>
        </header>

        <div className="s-content">{children}</div>
      </div>
    </div>
  );
}

/** Nếu chưa đăng nhập thì chuyển tới trang login tương ứng */
function RedirectToLogin({ role }: { role: UserRole }) {
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    nav(`${role === 'admin' ? '/admin' : role === 'kitchen' ? '/kitchen' : '/staff'}/login?next=${encodeURIComponent(loc.pathname)}`, {
      replace: true,
    });
  }, [nav, role, loc.pathname]);
  return <div className="loading-box">Chuyển tới trang đăng nhập...</div>;
}

/* ------------------------------------------------------------------ *
 *  Cấu hình menu theo role
 * ------------------------------------------------------------------ */

/**
 * Mục của phục vụ bàn.
 */
export const STAFF_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Vận hành',
    items: [
      { to: '/staff/orders', label: 'Danh sách Order', icon: '📋', badge: 'pending' },
      { to: '/staff/payments', label: 'Hóa đơn chưa thanh toán', icon: '💳', badge: 'unpaid' },
      { to: '/staff/tables', label: 'Bàn đang phục vụ', icon: '🪑' },
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

/**
 * Mục của phục vụ bếp — chỉ 2 mục: bảng bếp và in đơn bếp.
 * Bếp không thấy danh sách order tổng, hóa đơn, bàn, món ăn hay cài đặt.
 */
export const KITCHEN_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Bếp',
    items: [{ to: '/kitchen', label: 'Bảng bếp', icon: '🍳', badge: 'kitchenNew', end: true }],
  },
  {
    title: 'Khác',
    items: [{ to: '/kitchen/login', label: 'Đổi tài khoản', icon: '🔑' }],
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
      { to: '/admin/history', label: 'Lịch sử order', icon: '🧾' },
      { to: '/admin/settings', label: 'Cài đặt cơ sở', icon: '🏢' },
    ],
  },
];
