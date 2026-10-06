import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, tokenStore } from '../lib/http';
import { ROLE_LABEL, type StaffUser, type UserRole } from '../types';
import { useToast } from '../components/Toast';

interface Props {
  /** admin = quản trị · staff = phục vụ bàn · kitchen = phục vụ bếp */
  mode: UserRole;
}

/** Mỗi khu vực đăng nhập có 1 màn riêng, tên và nội dung mô tả riêng. */
const AREA: Record<UserRole, { icon: string; title: string; sub: string; home: string; hint: string }> = {
  admin: {
    icon: '🛠️',
    title: 'Quản trị hệ thống',
    sub: 'Quản lý tài khoản, món ăn, bàn QR và lịch sử order',
    home: '/admin',
    hint: 'Admin: admin / 1234',
  },
  staff: {
    icon: '👨‍🍳',
    title: 'Phục vụ bàn',
    sub: 'Nhận order, chuyển bếp và thanh toán cho khách',
    home: '/staff',
    hint: 'Phục vụ bàn: order / 1234 · check / 1234',
  },
  kitchen: {
    icon: '🍳',
    title: 'Phục vụ bếp',
    sub: 'Nhận đơn từ phục vụ bàn, tick món xong và in đơn bếp',
    home: '/kitchen',
    hint: 'Phục vụ bếp: bep / 1234',
  },
};

/** Các màn đăng nhập khác để chuyển qua lại. */
const OTHER_LOGINS: { to: string; role: UserRole }[] = [
  { to: '/admin/login', role: 'admin' },
  { to: '/staff/login', role: 'staff' },
  { to: '/kitchen/login', role: 'kitchen' },
];

export function Login({ mode }: Props) {
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const area = AREA[mode];
  const home = area.home;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<{ token: string; user: StaffUser }>(
        '/auth/login',
        { username: username.trim(), password },
        { staffToken: null, tableToken: null },
      );

      // Mỗi vai chỉ vào đúng khu của vai đó. Admin được cộng thêm
      // quyền phục vụ bàn (để chủ quán tự nhận order) nhưng vẫn phải
      // đăng nhập ở màn quản trị.
      const allowed =
        res.user.role === mode || (mode === 'staff' && res.user.role === 'admin');
      if (!allowed) {
        const want = AREA[mode];
        const target = OTHER_LOGINS.find((l) => l.role === res.user.role);
        throw new Error(
          `Tài khoản này là ${ROLE_LABEL[res.user.role].toLowerCase()}. ` +
            `Vui lòng đăng nhập ở màn "${want.title}"${target ? '' : ' tương ứng'}.`,
        );
      }

      tokenStore.setStaffToken(res.token);
      toast.success(`Xin chào ${res.user.full_name}!`);
      const next = params.get('next');
      nav(next && next.startsWith(home) ? next : home, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">{area.icon}</div>
        <h1>{area.title}</h1>
        <p className="sub">{area.sub}</p>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="u">Tài khoản</label>
            <input
              id="u"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Nhập tài khoản"
            />
          </div>
          <div className="field">
            <label htmlFor="p">Mật khẩu</label>
            <input
              id="p"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Nhập mật khẩu"
            />
          </div>

          {error ? <div className="alert alert-error">{error}</div> : null}

          <button className="btn btn-block btn-lg" disabled={busy}>
            {busy && <span className="spinner" />}
            Đăng nhập
          </button>
        </form>

        <div className="login-hint">
          <strong>Tài khoản mẫu</strong>
          <div style={{ marginTop: 5 }}>{area.hint}</div>
          <div style={{ marginTop: 6 }} className="tiny muted">
            Đổi vai trò:{' '}
            {OTHER_LOGINS.filter((l) => l.role !== mode).map((l, i) => (
              <span key={l.to}>
                {i > 0 ? ' · ' : ''}
                <a href={l.to}>→ {AREA[l.role].title}</a>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
