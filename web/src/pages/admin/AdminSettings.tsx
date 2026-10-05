import { useState } from 'react';
import { AsyncBlock, ModalFooter } from '../../components/PageParts';
import { api } from '../../lib/http';
import { useAsync } from '../../hooks/useAsync';
import { ADMIN_SECTIONS, AppLayout } from '../../components/AppLayout';
import { formatCoord } from '../../lib/format';
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
  /** Tọa độ (chuỗi để không mất chữ số 0 ở đầu) */
  lat: string;
  lng: string;
  is_active: boolean;
}

const emptyForm = (): FormState => ({
  name: '',
  address: '',
  phone: '',
  note: '',
  lat: '',
  lng: '',
  is_active: true,
});

/**
 * Kiểm tra tọa độ nhập tay trước khi gửi (server cũng kiểm tra lại).
 * Vĩ độ -90..90, kinh độ -180..180.
 */
function validateCoords(lat: string, lng: string): string[] {
  const out: string[] = [];
  const one = (raw: string, label: string, limit: number) => {
    const v = raw.trim();
    if (!v) return;
    const n = Number(v);
    if (!Number.isFinite(n)) return out.push(`${label} không phải là số hợp lệ.`);
    if (n < -limit || n > limit) out.push(`${label} phải nằm trong khoảng ${-limit} đến ${limit}.`);
  };
  one(lat, 'Vĩ độ', 90);
  one(lng, 'Kinh độ', 180);
  if ((lat.trim() && !lng.trim()) || (!lat.trim() && lng.trim())) {
    out.push('Cần nhập cả vĩ độ và kinh độ, hoặc để trống cả hai.');
  }
  return out;
}

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
    const coordErrors = validateCoords(form.lat, form.lng);
    if (coordErrors.length) return setErrors(coordErrors);

    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        note: form.note.trim() || null,
        lat: form.lat.trim() || null,
        lng: form.lng.trim() || null,
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
        <ul className="bullets">
          <li>Trong <strong>Quản lý bàn &amp; mã QR</strong>, mỗi bàn thuộc 1 cơ sở.</li>
          <li>Trong <strong>Quản lý tài khoản</strong>, gán nhân viên vào cơ sở.</li>
          <li>Nhân viên chỉ thấy đơn &amp; bàn của cơ sở mình. Admin xem tất cả và có bộ lọc cơ sở.</li>
          <li>
            <strong>Toạ độ</strong> (vĩ độ/kinh độ) dùng cho tính năng chấm công vị trí.
          </li>
        </ul>
      </div>

      <AsyncBlock
        loading={state.loading}
        error={state.error}
        loadingText="Đang tải..."
        empty={rows.length === 0 ? (
          <div className="empty">
            <div className="icon">🏢</div>
            <div>Chưa có cơ sở nào</div>
            <button className="btn mt-14" onClick={() => setForm(emptyForm())} type="button">
              + Tạo cơ sở đầu tiên
            </button>
          </div>
        ) : undefined}
      >
        <div className="card-grid">
          {rows.map((b) => (
            <div className="card" key={b.id}>
              <div className="row-between mb-8">
                <strong style={{ fontSize: 16 }}>🏢 {b.name}</strong>
                <span className={`badge ${b.is_active ? 'badge-ok' : ''}`}>
                  {b.is_active ? 'Hoạt động' : 'Đã tắt'}
                </span>
              </div>

              <div className="small mb-6">
                📍 {b.address ?? <span className="muted">Chưa có địa chỉ</span>}
              </div>
              <div className="small mb-6">
                ☎️ {b.phone ?? <span className="muted">Chưa có số điện thoại</span>}
              </div>
              <div className="small mb-6">
                📌{' '}
                {b.lat != null && b.lng != null ? (
                  <a
                    href={`https://www.google.com/maps?q=${encodeURIComponent(`${b.lat},${b.lng}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mono"
                    style={{ fontSize: 12 }}
                  >
                    {formatCoord(b.lat)}, {formatCoord(b.lng)}
                  </a>
                ) : (
                  <span className="muted">Chưa nhập toạ độ</span>
                )}
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
                      // API trả toạ độ dạng SỐ (pg ép NUMERIC sang number) -> ép
                      // về chuỗi, nếu không các .trim() phía dưới sẽ văng lỗi.
                      lat: b.lat == null ? '' : String(b.lat),
                      lng: b.lng == null ? '' : String(b.lng),
                      is_active: b.is_active,
                    });
                    setErrors([]);
                  }}
                  type="button"
                >
                  Sửa
                </button>
                <button
                  className="btn btn-ghost btn-sm danger-text"

                  onClick={() => setDeleting(b)}
                  type="button"
                >
                  Xoá
                </button>
              </div>
            </div>
          ))}
        </div>
      </AsyncBlock>

      {/* ---- Form cơ sở ---- */}
      <Modal
        open={!!form}
        title={form?.id ? `Sửa cơ sở: ${form.name}` : 'Thêm cơ sở mới'}
        onClose={() => setForm(null)}
        footer={<ModalFooter onCancel={() => setForm(null)} onConfirm={save} busy={busy} confirmLabel={form?.id ? 'Lưu' : 'Tạo cơ sở'} />}
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

            <div className="field">
              <label htmlFor="blat">Toạ độ (vĩ độ, kinh độ)</label>
              <div className="row gap-10">
                <input
                  id="blat"
                  className="input mono"
                  inputMode="decimal"
                  value={form.lat}
                  onChange={(e) => setForm({ ...form, lat: e.target.value })}
                  placeholder="10.7769"
                />
                <input
                  className="input mono"
                  inputMode="decimal"
                  aria-label="Kinh độ"
                  value={form.lng}
                  onChange={(e) => setForm({ ...form, lng: e.target.value })}
                  placeholder="106.7009"
                />
              </div>
              <div className="tiny muted mt-4">
                Dùng cho tính năng <strong>chấm công vị trí</strong> (định vị nhân viên trong bán kính cơ sở).
                Mở Google Maps → bấm chuột phải vào vị trí cơ sở → sao chép 2 con số đầu. Để trống nếu chưa
                cần dùng.
              </div>
              {(form.lat || form.lng) && !validateCoords(form.lat, form.lng).length ? (
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <a
                    className="btn btn-secondary btn-sm"
                    href={`https://www.google.com/maps?q=${encodeURIComponent(`${form.lat.trim()},${form.lng.trim()}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    🗺 Xem trên Google Maps
                  </a>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setForm({ ...form, lat: '', lng: '' })}
                    type="button"
                  >
                    ✕ Xoá toạ độ
                  </button>
                </div>
              ) : null}
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
            <div className="small muted mt-8">
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
