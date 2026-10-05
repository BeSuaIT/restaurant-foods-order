import { useState } from 'react';
import { api, useAsync } from '../../api';
import { ADMIN_SECTIONS, AppLayout } from '../../components/AppLayout';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import type { Branch, RestTable } from '../../types';

interface TableForm {
  id?: number;
  code: string;
  name: string;
  area: string;
  seats: number;
  branch_id: number | null;
  is_active: boolean;
  note: string;
}

const emptyTable = (): TableForm => ({
  code: '',
  name: '',
  area: '',
  seats: 4,
  branch_id: null,
  is_active: true,
  note: '',
});

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

/**
 * QUẢN LÝ BÀN & MÃ QR — chỉ Admin.
 * Mỗi bàn thuộc 1 cơ sở và có 1 mã QR riêng; in ra dán lên bàn, khách quét là vào màn order.
 */
export function AdminTables() {
  const toast = useToast();
  const [form, setForm] = useState<TableForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<RestTable | null>(null);
  const [sheet, setSheet] = useState<QrSheetItem[] | null>(null);
  const [branchFilter, setBranchFilter] = useState<'' | number>('');

  const branches = useAsync<Branch[]>((signal) => api.get<Branch[]>('/admin/branches', { signal }), []);
  const branchList = branches.data ?? [];

  const qs = branchFilter === '' ? '' : `?branch_id=${branchFilter}`;
  const state = useAsync<RestTable[]>(
    (signal) => api.get<RestTable[]>(`/admin/tables${qs}`, { signal }),
    [qs],
  );
  const rows = state.data ?? [];

  const save = async () => {
    if (!form) return;
    setErrors([]);
    if (!form.code.trim() || !form.name.trim()) {
      setErrors(['Mã bàn và tên bàn không được để trống.']);
      return;
    }
    if (!form.branch_id) {
      setErrors(['Vui lòng chọn cơ sở cho bàn.']);
      return;
    }
    setBusy(true);
    try {
      const body = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        area: form.area || null,
        seats: Number(form.seats) || 4,
        branch_id: form.branch_id,
        is_active: form.is_active,
        note: form.note || null,
      };
      if (form.id) {
        await api.patch(`/admin/tables/${form.id}`, body);
        toast.success('Đã cập nhật bàn.');
      } else {
        await api.post('/admin/tables', body);
        toast.success(`Đã tạo bàn ${body.code} kèm mã QR.`);
      }
      setForm(null);
      state.reload();
    } catch (err) {
      const e = err as { message?: string };
      setErrors([e.message ?? 'Không lưu được.']);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await api.del<{ soft_deleted?: boolean; message?: string }>(`/admin/tables/${deleting.id}`);
      toast.success(res.message ?? 'Đã xoá bàn.');
      setDeleting(null);
      state.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không xoá được.');
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async (t: RestTable) => {
    try {
      await api.post(`/admin/tables/${t.id}/regenerate-qr`);
      toast.success(`Đã tạo mã QR mới cho bàn ${t.code}. Thẻ QR cũ sẽ không dùng được.`);
      state.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không tạo được QR.');
    }
  };

  const openSheet = async () => {
    setBusy(true);
    try {
      const data = await api.get<QrSheetItem[]>(`/admin/tables/qr-sheet${qs}`);
      setSheet(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không tải được mã QR.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppLayout
      role="admin"
      sections={ADMIN_SECTIONS}
      title="Quản lý bàn & mã QR"
      subtitle={`${rows.length} bàn · ${rows.filter((t) => t.is_active).length} đang phục vụ`}
      actions={
        <>
          <select
            className="input"
            style={{ width: 190, padding: '7px 10px' }}
            value={branchFilter === '' ? '' : String(branchFilter)}
            onChange={(e) => setBranchFilter(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">🏢 Tất cả cơ sở</option>
            {branchList.map((b) => (
              <option key={b.id} value={b.id}>
                🏢 {b.name}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={openSheet} disabled={busy} type="button">
            🖨 In toàn bộ thẻ QR
          </button>
          <button
            className="btn btn-sm"
            onClick={() => { setForm(emptyTable()); setErrors([]); }}
            type="button"
          >
            + Thêm bàn
          </button>
        </>
      }
    >
      <div className="alert alert-info">
        📱 In thẻ QR và dán lên mặt bàn. Khách quét mã sẽ tự động vào màn nhập tên + số điện thoại rồi order.
        Trường <strong>URL</strong> bên dưới là địa chỉ chứa mã QR — đảm bảo <code>PUBLIC_URL</code> trong cấu hình đang trỏ đúng.
      </div>

      {state.loading ? (
        <div className="loading-box">Đang tải...</div>
      ) : state.error ? (
        <div className="alert alert-error">{state.error}</div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <div className="icon">🪑</div>
          <div>Chưa có bàn nào</div>
          <button className="btn" style={{ marginTop: 14 }} onClick={() => setForm(emptyTable())} type="button">
            + Thêm bàn đầu tiên
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Mã bàn</th>
                <th>Tên bàn</th>
                <th>Cơ sở</th>
                <th>Khu vực</th>
                <th className="right">Số chỗ</th>
                <th className="right">Đơn đang mở</th>
                <th>Trạng thái</th>
                <th>Đường dẫn QR</th>
                <th className="right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong className="c-price">{t.code}</strong>
                  </td>
                  <td>{t.name}</td>
                  <td className="small">{t.branch_name ?? <span className="muted">—</span>}</td>
                  <td className="small">{t.area ?? '—'}</td>
                  <td className="right">{t.seats}</td>
                  <td className="right">
                    {t.active_order_count ? (
                      <span className="badge badge-warn">{t.active_order_count}</span>
                    ) : (
                      <span className="muted">0</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${t.is_active ? 'badge-ok' : ''}`}>{t.is_active ? 'Hoạt động' : 'Đã tắt'}</span>
                  </td>
                  <td className="tiny mono muted">
                    <div className="truncate" style={{ maxWidth: 240 }} title={t.qr_url}>
                      {t.qr_url ?? '—'}
                    </div>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 5, justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setForm({
                            id: t.id,
                            code: t.code,
                            name: t.name,
                            area: t.area ?? '',
                            seats: t.seats,
                            branch_id: t.branch_id,
                            is_active: t.is_active,
                            note: t.note ?? '',
                          });
                          setErrors([]);
                        }}
                        type="button"
                      >
                        Sửa
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => void regenerate(t)} type="button" title="Tạo QR mới">
                        🔄
                      </button>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setDeleting(t)} type="button">
                        Xoá
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Form bàn ---- */}
      <Modal
        open={!!form}
        title={form?.id ? `Sửa bàn: ${form.code}` : 'Thêm bàn mới'}
        onClose={() => setForm(null)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setForm(null)} disabled={busy} type="button">
              Huỷ
            </button>
            <button className="btn" onClick={save} disabled={busy} type="button">
              {busy && <span className="spinner" />}
              {form?.id ? 'Lưu' : 'Tạo bàn'}
            </button>
          </>
        }
      >
        {form ? (
          <>
            {errors.length > 0 ? <div className="alert alert-error">{errors.join(', ')}</div> : null}
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div className="field" style={{ width: 120 }}>
                <label htmlFor="tc">Mã bàn *</label>
                <input id="tc" className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} placeholder="A1" />
              </div>
              <div className="field grow">
                <label htmlFor="tn">Tên bàn *</label>
                <input id="tn" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bàn 1 - Tầng 1" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="tb">Cơ sở *</label>
              <select
                id="tb"
                className="input"
                value={form.branch_id ?? ''}
                onChange={(e) => setForm({ ...form, branch_id: e.target.value === '' ? null : Number(e.target.value) })}
              >
                <option value="">— Chọn cơ sở —</option>
                {branchList.map((b) => (
                  <option key={b.id} value={b.id}>
                    🏢 {b.name}
                    {b.is_active ? '' : ' (đã tắt)'}
                  </option>
                ))}
              </select>
              <div className="tiny muted" style={{ marginTop: 4 }}>
                Bàn thuộc cơ sở nào thì chỉ nhân viên của cơ sở đó mới thấy &amp; phục vụ được.
              </div>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <div className="field grow">
                <label htmlFor="ta">Khu vực</label>
                <input id="ta" className="input" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="VD: Tầng 1, Ngoài trời" />
              </div>
              <div className="field" style={{ width: 110 }}>
                <label htmlFor="ts">Số chỗ</label>
                <input id="ts" className="input" type="number" min={1} max={50} value={form.seats} onChange={(e) => setForm({ ...form, seats: Number(e.target.value) })} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="tnt">Ghi chú</label>
              <input id="tnt" className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="VD: Bàn góc, view đẹp" />
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Bàn đang phục vụ (khách quét QR mới order được)
            </label>
          </>
        ) : null}
      </Modal>

      {/* ---- Bảng QR để in ---- */}
      <Modal
        open={!!sheet}
        size="lg"
        title="In thẻ QR cho các bàn"
        onClose={() => setSheet(null)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setSheet(null)} type="button">
              Đóng
            </button>
            <button className="btn" onClick={() => window.print()} type="button">
              🖨 In toàn bộ thẻ QR
            </button>
          </>
        }
      >
        {sheet ? (
          <>
            <div className="alert alert-info no-print">
              Cắt từng thẻ và dán lên mặt bàn. Có thể in nhiều bản của cùng một mã QR.
            </div>
            <div className="qr-sheet">
              {sheet.map((q) => (
                <div className="qr-card" key={q.id}>
                  <div style={{ fontSize: 19, fontWeight: 800 }}>{q.name}</div>
                  <div className="tiny muted" style={{ marginBottom: 7 }}>
                    {q.branch_name ? `${q.branch_name} · ` : ''}
                    {q.area ?? '—'} · {q.seats} chỗ
                  </div>
                  <img src={q.qr} alt={`QR bàn ${q.code}`} />
                  <div style={{ fontSize: 16, fontWeight: 800, marginTop: 7, color: 'var(--brand-dark)' }}>{q.code}</div>
                  <div className="tiny" style={{ fontWeight: 600 }}>
                    📱 Quét để gọi món
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        danger
        title="Xoá bàn"
        confirmLabel="Xoá"
        busy={busy}
        message={
          <div>
            Xoá bàn <strong>{deleting?.code}</strong> — {deleting?.name}?
            <div className="small muted" style={{ marginTop: 8 }}>
              Mã QR của bàn sẽ ngừng hoạt động. Nếu bàn đã có lịch sử order, hệ thống sẽ vô hiệu hoá thay vì xoá hẳn.
            </div>
          </div>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      />
    </AppLayout>
  );
}
