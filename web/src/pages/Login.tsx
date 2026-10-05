import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, tokenStore } from '../lib/http';
import type { StaffUser } from '../types';
import { useToast } from '../components/Toast';

interface Props {
  /** admin | staff */
  mode: 'admin' | 'staff';
}

export function Login({ mode }: Props) {
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = mode === 'admin';
  const home = isAdmin ? '/admin' : '/staff';

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

      // Admin chỉ vào khu vực Admin, nhân viên vào khu vực nhân viên
      if (isAdmin && res.user.role !== 'admin') {
        throw new Error('Tài khoản này không có quyền quản trị. Vui lòng đăng nhập ở màn Nhân viên.');
      }
      if (!isAdmin && res.user.role !== 'staff') {
        throw new Error('Tài khoản Admin vui lòng đăng nhập tại màn hình Quản trị.');
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
        <div className="login-logo">{isAdmin ? '🛠️' : '👨‍🍳'}</div>
        <h1>{isAdmin ? 'Quản trị hệ thống' : 'Màn hình nhân viên'}</h1>
        <p className="sub">
          {isAdmin
            ? 'Quản lý tài khoản, món ăn, bàn QR và lịch sử order'
            : 'Nhận order và thanh toán cho khách'}
        </p>

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
          <div style={{ marginTop: 5 }}>
            Admin: <code>admin</code> / <code>1234</code>
          </div>
          <div>
            Nhân viên: <code>order</code> / <code>1234</code> · <code>check</code> / <code>1234</code>
          </div>
          <div style={{ marginTop: 6 }} className="tiny muted">
            {isAdmin ? (
              <a href="/staff">→ Đi đến màn hình Nhân viên</a>
            ) : (
              <a href="/admin">→ Đi đến màn hình Quản trị</a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
