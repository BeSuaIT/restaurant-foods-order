import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, isValidVnPhone, tokenStore } from '../../api';
import { useToast } from '../../components/Toast';

/** Bước sau khi quét QR: nhập tên + số điện thoại. */
export function Join() {
  const { slug = '' } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const toast = useToast();

  const [table, setTable] = useState<{
    id: number;
    code: string;
    name: string;
    area: string | null;
    seats: number;
    qr_token: string;
  } | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Tra cứu thông tin bàn từ mã QR hoặc mã bàn ngắn
  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .get<{ id: number; code: string; name: string; area: string | null; seats: number; qr_token: string }>(
        `/tables/lookup?q=${encodeURIComponent(slug)}`,
        { tableToken: null, staffToken: null },
      )
      .then((t) => alive && setTable(t))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : 'Mã không hợp lệ.'));
    return () => {
      alive = false;
    };
  }, [slug]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!table) return;
    setError(null);

    if (name.trim().length < 2) {
      setError('Vui lòng nhập tên của bạn (tối thiểu 2 ký tự).');
      return;
    }
    if (!isValidVnPhone(phone)) {
      setError('Số điện thoại không hợp lệ. VD: 0912 345 678');
      return;
    }

    setBusy(true);
    try {
      const res = await api.post<{ token: string }>(
        '/session/join',
        { qrToken: table.qr_token, name: name.trim(), phone: phone.trim() },
        { tableToken: null, staffToken: null },
      );
      tokenStore.setTableToken(res.token);
      toast.success(`Chào mừng ${name.trim()}! Bắt đầu chọn món nhé.`);
      nav('/menu', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể đăng ký phiên bàn.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="c-join">
      <div className="c-join-card">
        <div className="c-join-logo">🍽️</div>
        <h1>Thông tin của bạn</h1>
        <p className="muted" style={{ fontSize: 14 }}>
          Để nhà hàng phục vụ và liên hệ khi cần
        </p>

        {error && !table ? (
          <div className="alert alert-error" style={{ marginTop: 18, textAlign: 'left' }}>
            {error}
            <div style={{ marginTop: 10 }}>
              <Link to="/">← Về trang nhập mã bàn</Link>
            </div>
          </div>
        ) : table ? (
          <>
            <div className="c-table-chip" style={{ marginTop: 18 }}>
              🪑 {table.name}
              {table.area ? ` · ${table.area}` : ''}
            </div>

            <form onSubmit={submit} style={{ textAlign: 'left' }}>
              <div className="field">
                <label htmlFor="cname">Họ và tên *</label>
                <input
                  id="cname"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="VD: Nguyễn Văn A"
                  autoComplete="name"
                  maxLength={80}
                />
              </div>

              <div className="field">
                <label htmlFor="cphone">Số điện thoại *</label>
                <input
                  id="cphone"
                  className="input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0912 345 678"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={20}
                />
              </div>

              {error ? <div className="alert alert-error">{error}</div> : null}

              <button className="btn btn-block btn-lg" disabled={busy}>
                {busy && <span className="spinner" />}
                Bắt đầu order
              </button>
            </form>

            <p className="tiny muted" style={{ marginTop: 16, textAlign: 'left' }}>
              Thông tin của bạn chỉ dùng để phục vụ bàn và tra cứu hóa đơn, không chia sẻ cho bên thứ ba.
            </p>
          </>
        ) : (
          <div className="loading-box">Đang kiểm tra mã QR...</div>
        )}
      </div>
    </div>
  );
}
