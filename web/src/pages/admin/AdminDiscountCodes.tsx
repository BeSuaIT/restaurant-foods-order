import { useState } from 'react';
import { api, formatDateTime, useAsync } from '../../api';
import { ADMIN_SECTIONS, AppLayout } from '../../components/AppLayout';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import type { DiscountCode } from '../../types';

/* ================================================================== *
 *  QUẢN LÝ MÃ GIẢM GIÁ — chỉ Admin
 *
 *  Admin tạo mã + % giảm + thời gian áp dụng (ngày bắt đầu / kết thúc).
 *  Khi khách thanh toán, nhân viên nhập mã ở màn Thanh toán để giảm tiền bill.
 * ================================================================== */

interface FormState {
  id?: number;
  code: string;
  description: string;
  percent: number;
  /** yyyy-MM-dd */
  start_date: string;
  end_date: string;
  is_active: boolean;
}

const todayStr = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

const emptyForm = (): FormState => ({
  code: '',
  description: '',
  percent: 10,
  start_date: todayStr(),
  end_date: plusDays(90),
  is_active: true,
});

/** Ngày trong DB -> yyyy-MM-dd (để đưa vào <input type="date">) */
const toDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');

/** Trạng thái hiển thị dựa trên cờ + mốc thời gian */
function codeState(d: DiscountCode): { label: string; cls: string } {
  if (!d.is_active) return { label: 'Đã tắt', cls: '' };
  const now = Date.now();
  if (d.start_at && new Date(d.start_at).getTime() > now) return { label: 'Chưa tới hạn', cls: 'badge-info' };
  if (d.end_at && new Date(d.end_at).getTime() < now) return { label: 'Đã hết hạn', cls: 'badge-danger' };
  return { label: 'Đang áp dụng', cls: 'badge-ok' };
}

export function AdminDiscountCodes() {
  const toast = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<DiscountCode | null>(null);

  const state = useAsync<DiscountCode[]>((signal) => api.get<DiscountCode[]>('/admin/discount-codes', { signal }), []);
  const rows = state.data ?? [];

  const save = async () => {
    if (!form) return;
    setErrors([]);

    const code = form.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const percent = Number(form.percent);
    if (code.length < 2) return setErrors(['Mã giảm giá tối thiểu 2 ký tự.']);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return setErrors(['Phần trăm giảm phải từ 0 đến 100.']);
    }
    if (form.end_date && form.start_date && form.end_date < form.start_date) {
      return setErrors(['Ngày kết thúc phải sau ngày bắt đầu.']);
    }

    setBusy(true);
    try {
      const body = {
        code,
        description: form.description.trim() || null,
        percent,
        start_at: form.start_date || null,
        end_at: form.end_date || null,
        is_active: form.is_active,
      };
      if (form.id) {
        await api.patch(`/admin/discount-codes/${form.id}`, body);
        toast.success(`Đã cập nhật mã ${code}.`);
      } else {
        await api.post('/admin/discount-codes', body);
        toast.success(`Đã tạo mã giảm giá ${code} (-${percent}%).`);
      }
      setForm(null);
      state.reload();
    } catch (err) {
      setErrors([(err as { message?: string }).message ?? 'Không lưu được.']);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (d: DiscountCode) => {
    try {
      await api.patch(`/admin/discount-codes/${d.id}`, {
        code: d.code,
        description: d.description,
        percent: d.percent,
        start_at: d.start_at,
        end_at: d.end_at,
        is_active: !d.is_active,
      });
      toast.success(d.is_active ? `Đã ngừng mã ${d.code}.` : `Đã kích hoạt mã ${d.code}.`);
      state.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không cập nhật được.');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await api.del<{ soft_deleted?: boolean; message?: string }>(
        `/admin/discount-codes/${deleting.id}`,
      );
      toast.success(res.message ?? 'Đã xoá mã giảm giá.');
      setDeleting(null);
      state.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không xoá được.');
    } finally {
      setBusy(false);
    }
  };

  const active = rows.filter((d) => {
    const s = codeState(d);
    return s.cls === 'badge-ok';
  }).length;

  return (
    <AppLayout
      role="admin"
      sections={ADMIN_SECTIONS}
      title="Mã giảm giá"
      subtitle={`${rows.length} mã · ${active} đang áp dụng`}
      actions={
        <button className="btn btn-sm" onClick={() => { setForm(emptyForm()); setErrors([]); }} type="button">
          + Thêm mã giảm giá
        </button>
      }
    >
      <div className="alert alert-info">
        🎟️ Khi khách thanh toán, nhân viên nhập mã ở màn <strong>Hóa đơn chưa thanh toán</strong> để áp dụng giảm giá
        cho bill. Mã chỉ dùng được trong khoảng thời gian bạn đặt.
      </div>

      {state.loading ? (
        <div className="loading-box">Đang tải...</div>
      ) : state.error ? (
        <div className="alert alert-error">{state.error}</div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <div className="icon">🎟️</div>
          <div>Chưa có mã giảm giá nào</div>
          <button className="btn" style={{ marginTop: 14 }} onClick={() => setForm(emptyForm())} type="button">
            + Tạo mã đầu tiên
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Mô tả</th>
                <th className="right">Giảm</th>
                <th>Bắt đầu</th>
                <th>Kết thúc</th>
                <th className="right">Đã dùng</th>
                <th>Trạng thái</th>
                <th className="right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const s = codeState(d);
                return (
                  <tr key={d.id}>
                    <td>
                      <strong className="mono" style={{ fontSize: 15, letterSpacing: 0.5 }}>
                        {d.code}
                      </strong>
                    </td>
                    <td className="small">{d.description ?? '—'}</td>
                    <td className="right">
                      <span className="badge badge-brand">-{d.percent}%</span>
                    </td>
                    <td className="small muted">{d.start_at ? formatDateTime(d.start_at) : 'Không giới hạn'}</td>
                    <td className="small muted">{d.end_at ? formatDateTime(d.end_at) : 'Không giới hạn'}</td>
                    <td className="right">{d.used_count}</td>
                    <td>
                      <span className={`badge ${s.cls}`}>{s.label}</span>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 5, justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setForm({
                              id: d.id,
                              code: d.code,
                              description: d.description ?? '',
                              percent: d.percent,
                              start_date: toDateInput(d.start_at),
                              end_date: toDateInput(d.end_at),
                              is_active: d.is_active,
                            });
                            setErrors([]);
                          }}
                          type="button"
                        >
                          Sửa
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => void toggleActive(d)} type="button">
                          {d.is_active ? 'Tắt' : 'Bật'}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => setDeleting(d)}
                          type="button"
                        >
                          Xoá
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Form mã giảm giá ---- */}
      <Modal
        open={!!form}
        title={form?.id ? `Sửa mã: ${form.code}` : 'Thêm mã giảm giá'}
        onClose={() => setForm(null)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setForm(null)} disabled={busy} type="button">
              Huỷ
            </button>
            <button className="btn" onClick={save} disabled={busy} type="button">
              {busy && <span className="spinner" />}
              {form?.id ? 'Lưu' : 'Tạo mã'}
            </button>
          </>
        }
      >
        {form ? (
          <>
            {errors.length > 0 ? <div className="alert alert-error">{errors.join(', ')}</div> : null}

            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div className="field" style={{ width: 170 }}>
                <label htmlFor="dc">Mã giảm giá *</label>
                <input
                  id="dc"
                  className="input mono"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })}
                  placeholder="GIAM10"
                  maxLength={40}
                />
              </div>
              <div className="field" style={{ width: 140 }}>
                <label htmlFor="dp">Phần trăm giảm *</label>
                <input
                  id="dp"
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  value={form.percent}
                  onChange={(e) => setForm({ ...form, percent: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="dd">Mô tả</label>
              <input
                id="dd"
                className="input"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="VD: Giảm 10% cho đơn từ 100.000đ"
              />
            </div>

            <div className="row" style={{ gap: 12 }}>
              <div className="field grow">
                <label htmlFor="ds">Bắt đầu áp dụng</label>
                <input
                  id="ds"
                  className="input"
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                />
              </div>
              <div className="field grow">
                <label htmlFor="de">Kết thúc áp dụng</label>
                <input
                  id="de"
                  className="input"
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                />
              </div>
            </div>
            <div className="tiny muted" style={{ marginTop: -6, marginBottom: 10 }}>
              Để trống ngày nghĩa là không giới hạn về phía đó. Hệ thống so sánh theo giờ Việt Nam.
            </div>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Kích hoạt mã này
            </label>
          </>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        danger
        title="Xoá mã giảm giá"
        confirmLabel="Xoá"
        busy={busy}
        message={
          <div>
            Xoá mã <strong>{deleting?.code}</strong>?
            <div className="small muted" style={{ marginTop: 8 }}>
              Nếu mã đã dùng trên hóa đơn, hệ thống sẽ ngừng hoạt động mã thay vì xoá hẳn.
            </div>
          </div>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      />
    </AppLayout>
  );
}
