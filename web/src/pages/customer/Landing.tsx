import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, tokenStore } from '../../lib/http';
/** Trang chủ: khách nhập mã bàn hoặc quét QR. */
export function Landing() {
  const [code, setCode] = useState('');
  const [table, setTable] = useState<{ id: number; code: string; name: string; area: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = code.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const found = await api.get<{ id: number; code: string; name: string; area: string | null }>(
        `/tables/lookup?q=${encodeURIComponent(q)}`,
        { tableToken: null, staffToken: null },
      );
      setTable(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tìm thấy bàn.');
      setTable(null);
    } finally {
      setBusy(false);
    }
  };

  // Đã có phiên bàn trước đó -> gợi ý quay lại
  const hasSession = !!tokenStore.getTableToken();

  return (
    <div className="c-join">
      <div className="c-join-card">
        <div className="c-join-logo">🍽️</div>
        <h1>Order đồ ăn</h1>
        <p className="muted" style={{ fontSize: 14 }}>
          Quét mã QR trên bàn để bắt đầu gọi món
        </p>

        {hasSession && !table ? (
          <div className="alert alert-info" style={{ textAlign: 'left' }}>
            <div>
              Bạn đang có phiên order.{' '}
              <Link to="/menu" style={{ textDecoration: 'underline' }}>
                Tiếp tục order
              </Link>
            </div>
            <button
              className="btn btn-secondary btn-sm mt-10"

              onClick={() => {
                if (
                  window.confirm(
                    'Kết thúc phiên order đang mở?\n\nBạn sẽ phải quét lại mã QR trên bàn khi muốn order.',
                  )
                ) {
                  api
                    .del('/order/session')
                    .catch(() => undefined)
                    .finally(() => {
                      tokenStore.clearTableToken();
                      setTable(null);
                    });
                }
              }}
              type="button"
            >
              ✕ Kết thúc phiên này
            </button>
          </div>
        ) : null}

        <form onSubmit={lookup} style={{ marginTop: 20, textAlign: 'left' }}>
          <div className="field">
            <label htmlFor="tcode">
              Mã bàn <span className="hint">(VD: A1, B2 — in trên thẻ QR)</span>
            </label>
            <input
              id="tcode"
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Nhập mã bàn"
              autoComplete="off"
            />
          </div>
          {error ? <div className="alert alert-error">{error}</div> : null}
          <button className="btn btn-block btn-lg" disabled={busy || !code.trim()}>
            {busy && <span className="spinner" />}
            Tiếp tục
          </button>
        </form>

        {table ? (
          <div style={{ marginTop: 18 }}>
            <div className="c-table-chip">
              🪑 {table.name} {table.area ? `· ${table.area}` : ''}
            </div>
            <div>
              <Link className="btn btn-block btn-lg" to={`/join/${table.code}`}>
                Vào bàn {table.code}
              </Link>
            </div>
          </div>
        ) : null}

        <div className="small muted" style={{ marginTop: 22, textAlign: 'left' }}>
          <strong>Hướng dẫn:</strong>
          <ol style={{ paddingLeft: 18, margin: '6px 0 0' }}>
            <li>Quét mã QR dán trên mặt bàn.</li>
            <li>Nhập tên và số điện thoại của bạn.</li>
            <li>Chọn món, gửi đơn và chờ nhân viên xác nhận.</li>
          </ol>
        </div>

        <div className="row c-foot-links">
          <Link className="small muted" to="/staff">
            👨‍🍳 Nhân viên
          </Link>
          <Link className="small muted" to="/admin">
            🛠 Quản trị
          </Link>
        </div>
      </div>
    </div>
  );
}
