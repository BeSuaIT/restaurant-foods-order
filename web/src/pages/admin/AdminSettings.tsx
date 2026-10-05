import { useState } from 'react';
import { api, useAsync } from '../../api';
import { ADMIN_SECTIONS, AppLayout } from '../../components/AppLayout';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import type { Branch } from '../../types';

/* ================================================================== *
 *  CÀI ĐẶT CƠ SỞ — chỉ Admin
 *
 *  Mỗi cơ sở (chi nhánh) có tên + địa chỉ. Bàn & nhân viên được gán vào cơ sở,
 *  nhân viên chỉ thấy đơn/bàn của cơ sở mình, Admin xem tất cả.
 * ================================================================== */

interface FormState {
  id?: number;
  name: string;
  address: string;
  phone: string;
  note: string;
  is_active: boolean;
}

const emptyForm = (): FormState => ({
  name: '',
  address: '',
  phone: '',
  note: '',
  is_active: true,
});

export function AdminSettings() {
  const toast = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<Branch | null>(null);

  const state = useAsync<Branch[]>((signal) => api.get<Branch[]>('/admin/branches', { signal }), []);
  const rows = state.data ?? [];

  const save = async () => {
    if (!form) return;
    setErrors([]);
    if (!form.name.trim()) return setErrors(['Tên cơ sở không được để trống.']);

    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        note: form.note.trim() || null,
        is_active: form.is_active,
      };
      if (form.id) {
        await api.patch(`/admin/branches/${form.id}`, body);
        toast.success('Đã cập nhật cơ sở.');
      } else {
        await api.post('/admin/branches', body);
        toast.success(`Đã tạo cơ sở "${body.name}".`);
      }
      setForm(null);
      state.reload();
    } catch (err) {
      setErrors([(err as { message?: string }).message ?? 'Không lưu được.']);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await api.del<{ soft_deleted?: boolean; message?: string }>(`/admin/branches/${deleting.id}`);
      toast.success(res.message ?? 'Đã xoá cơ sở.');
      setDeleting(null);
      state.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không xoá được.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppLayout
      role="admin"
      sections={ADMIN_SECTIONS}
      title="Cài đặt cơ sở"
      subtitle={`${rows.length} cơ sở · ${rows.filter((b) => b.is_active).length} đang hoạt động`}
      actions={
        <button className="btn btn-sm" onClick={() => { setForm(emptyForm()); setErrors([]); }} type="button">
          + Thêm cơ sở
        </button>
      }
    >
      <div className="alert alert-info">
        🏢 Cơ sở dùng để <strong>phân tách bàn &amp; nhân viên</strong>:
        <ul style={{ margin: '8px 0 0 18px' }}>
          <li>Trong <strong>Quản lý bàn &amp; mã QR</strong>, mỗi bàn thuộc 1 cơ sở.</li>
          <li>Trong <strong>Quản lý tài khoản</strong>, gán nhân viên vào cơ sở.</li>
          <li>Nhân viên chỉ thấy đơn &amp; bàn của cơ sở mình. Admin xem tất cả và có bộ lọc cơ sở.</li>
        </ul>
      </div>

      {state.loading ? (
        <div className="loading-box">Đang tải...</div>
      ) : state.error ? (
        <div className="alert alert-error">{state.error}</div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <div className="icon">🏢</div>
          <div>Chưa có cơ sở nào</div>
          <button className="btn" style={{ marginTop: 14 }} onClick={() => setForm(emptyForm())} type="button">
            + Tạo cơ sở đầu tiên
          </button>
        </div>
      ) : (
        <div className="card-grid">
          {rows.map((b) => (
            <div className="card" key={b.id}>
              <div className="row-between" style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 16 }}>🏢 {b.name}</strong>
                <span className={`badge ${b.is_active ? 'badge-ok' : ''}`}>
                  {b.is_active ? 'Hoạt động' : 'Đã tắt'}
                </span>
              </div>

              <div className="small" style={{ marginBottom: 6 }}>
                📍 {b.address ?? <span className="muted">Chưa có địa chỉ</span>}
              </div>
              <div className="small" style={{ marginBottom: 6 }}>
                ☎️ {b.phone ?? <span className="muted">Chưa có số điện thoại</span>}
              </div>
              {b.note ? (
                <div className="small muted" style={{ marginBottom: 10 }}>
                  {b.note}
                </div>
              ) : null}

              <div className="row" style={{ gap: 8, marginBottom: 12 }}>
                <span className="badge badge-info">🪑 {b.table_count ?? 0} bàn</span>
                <span className="badge badge-brand">👤 {b.user_count ?? 0} nhân viên</span>
              </div>

              <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setForm({
                      id: b.id,
                      name: b.name,
                      address: b.address ?? '',
                      phone: b.phone ?? '',
                      note: b.note ?? '',
                      is_active: b.is_active,
                    });
                    setErrors([]);
                  }}
                  type="button"
                >
                  Sửa
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => setDeleting(b)}
                  type="button"
                >
                  Xoá
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---- Form cơ sở ---- */}
      <Modal
        open={!!form}
        title={form?.id ? `Sửa cơ sở: ${form.name}` : 'Thêm cơ sở mới'}
        onClose={() => setForm(null)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setForm(null)} disabled={busy} type="button">
              Huỷ
            </button>
            <button className="btn" onClick={save} disabled={busy} type="button">
              {busy && <span className="spinner" />}
              {form?.id ? 'Lưu' : 'Tạo cơ sở'}
            </button>
          </>
        }
      >
        {form ? (
          <>
            {errors.length > 0 ? <div className="alert alert-error">{errors.join(', ')}</div> : null}
            <div className="field">
              <label htmlFor="bn">Tên cơ sở *</label>
              <input
                id="bn"
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="VD: Cơ sở Trung tâm"
              />
            </div>
            <div className="field">
              <label htmlFor="ba">Địa chỉ</label>
              <textarea
                id="ba"
                className="input"
                rows={2}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Số 123 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh"
              />
            </div>
            <div className="field">
              <label htmlFor="bph">Điện thoại</label>
              <input
                id="bph"
                className="input"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="02838220001"
              />
            </div>
            <div className="field">
              <label htmlFor="bno">Ghi chú</label>
              <input
                id="bno"
                className="input"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="VD: Cơ sở chính, 2 tầng + phòng riêng"
              />
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Cơ sở đang hoạt động
            </label>
          </>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        danger
        title="Xoá cơ sở"
        confirmLabel="Xoá"
        busy={busy}
        message={
          <div>
            Xoá cơ sở <strong>{deleting?.name}</strong>?
            <div className="small muted" style={{ marginTop: 8 }}>
              Cơ sở đang có {deleting?.table_count ?? 0} bàn và {deleting?.user_count ?? 0} nhân viên sẽ chỉ bị vô
              hiệu hoá. Hãy chuyển bàn/nhân viên sang cơ sở khác trước khi xoá.
            </div>
          </div>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      />
    </AppLayout>
  );
}
