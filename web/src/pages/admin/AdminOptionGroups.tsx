import { useState } from 'react';
import { AsyncBlock, ModalFooter } from '../../components/PageParts';
import { api } from '../../lib/http';
import { formatMoney } from '../../lib/format';
import { useAsync } from '../../hooks/useAsync';
import { ADMIN_SECTIONS, AppLayout } from '../../components/AppLayout';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import type { OptionGroupFull } from '../../types';

interface ItemForm {
  id?: number;
  name: string;
  price_delta: string;
  is_default: boolean;
  is_active: boolean;
}

interface GroupForm {
  id?: number;
  name: string;
  description: string;
  is_required: boolean;
  is_multiple: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  is_active: boolean;
  items: ItemForm[];
}

const newItem = (): ItemForm => ({ name: '', price_delta: '0', is_default: false, is_active: true });

const emptyGroup = (): GroupForm => ({
  name: '',
  description: '',
  is_required: false,
  is_multiple: false,
  min_select: 0,
  max_select: 1,
  sort_order: 0,
  is_active: true,
  items: [newItem()],
});

/**
 * QUẢN LÝ PHẦN CHỌN ĐI KÈM — chỉ Admin.
 * Ví dụ: nhóm "Nhân thêm" (chọn nhiều) gồm Thịt +15.000đ, Trứng +8.000đ...
 * Gán nhóm này cho món "Bánh mì" để khách được hỏi khi order.
 */
export function AdminOptionGroups() {
  const toast = useToast();
  const [form, setForm] = useState<GroupForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<OptionGroupFull | null>(null);

  const state = useAsync<OptionGroupFull[]>((signal) => api.get<OptionGroupFull[]>('/admin/option-groups', { signal }), []);

  const save = async () => {
    if (!form) return;
    setErrors([]);

    const items = form.items.filter((i) => i.name.trim());
    if (items.length === 0) {
      setErrors(['Cần ít nhất 1 lựa chọn trong nhóm.']);
      return;
    }
    if (form.name.trim().length < 1) {
      setErrors(['Vui lòng nhập tên nhóm.']);
      return;
    }
    const max = form.is_multiple ? form.max_select : 1;
    if (max < form.min_select) {
      setErrors(['Số lượng tối đa phải lớn hơn hoặc bằng số lượng tối thiểu.']);
      return;
    }

    setBusy(true);
    try {
      const body = {
        name: form.name,
        description: form.description || null,
        is_required: form.is_required,
        is_multiple: form.is_multiple,
        min_select: form.min_select,
        max_select: max,
        sort_order: form.sort_order,
        is_active: form.is_active,
        items: items.map((i) => ({
          id: i.id,
          name: i.name,
          price_delta: Number(i.price_delta.replace(/\D/g, '').replace('-', '')) || 0,
          is_default: i.is_default,
          is_active: i.is_active,
          sort_order: 0,
        })),
      };

      if (form.id) {
        await api.patch(`/admin/option-groups/${form.id}`, body);
        toast.success('Đã cập nhật nhóm lựa chọn.');
      } else {
        await api.post('/admin/option-groups', body);
        toast.success(`Đã tạo nhóm "${form.name}".`);
      }
      setForm(null);
      state.reload();
    } catch (err) {
      const e = err as { details?: { message?: string }[]; message?: string };
      setErrors(Array.isArray(e.details) && e.details.length ? e.details.map((d) => d.message ?? '') : [e.message ?? 'Không lưu được.']);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/admin/option-groups/${deleting.id}`);
      toast.success('Đã xoá nhóm lựa chọn.');
      setDeleting(null);
      state.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không xoá được.');
    } finally {
      setBusy(false);
    }
  };

  const rows = state.data ?? [];

  return (
    <AppLayout
      role="admin"
      sections={ADMIN_SECTIONS}
      title="Phần chọn đi kèm"
      subtitle="Định nghĩa các nhóm tuỳ chọn cho món ăn (VD: Nhân thêm, Sốt chấm, Mức cay)"
      actions={
        <button className="btn btn-sm" onClick={() => { setForm(emptyGroup()); setErrors([]); }} type="button">
          + Thêm nhóm
        </button>
      }
      onRefresh={state.reload}
      refreshing={state.loading}
    >
      <div className="alert alert-info">
        💡 Ví dụ: tạo nhóm <strong>"Nhân thêm"</strong> (chọn nhiều, tối đa 5) với các mục <em>Thịt nướng +15.000đ</em>,{' '}
        <em>Trứng +8.000đ</em>… rồi gán nhóm này cho món <strong>Bánh mì</strong> ở màn{' '}
        <a href="/admin/dishes">Quản lý món ăn</a>.
      </div>

      <AsyncBlock
        loading={state.loading}
        error={state.error}
        loadingText="Đang tải..."
        empty={rows.length === 0 ? (
          <div className="empty">
            <div className="icon">⚙️</div>
            <div>Chưa có nhóm lựa chọn nào</div>
            <button className="btn mt-14" onClick={() => setForm(emptyGroup())} type="button">
              + Tạo nhóm đầu tiên
            </button>
          </div>
        ) : undefined}
      >
        {rows.map((g) => (
          <div className="g-card" key={g.id}>
            <div className="g-card-head">
              <div>
                <div className="row" style={{ gap: 7 }}>
                  <strong style={{ fontSize: 15 }}>{g.name}</strong>
                  <span className={`badge ${g.is_multiple ? 'badge-info' : ''}`}>
                    {g.is_multiple ? `Chọn nhiều (${g.min_select}–${g.max_select})` : 'Chọn 1'}
                  </span>
                  {g.is_required ? <span className="badge badge-danger">Bắt buộc</span> : null}
                  {!g.is_active ? <span className="badge">Đang tắt</span> : null}
                  {g.dish_count > 0 ? (
                    <span className="badge badge-brand">Dùng cho {g.dish_count} món</span>
                  ) : (
                    <span className="badge">Chưa gán món</span>
                  )}
                </div>
                {g.description ? (
                  <div className="tiny muted mt-3">
                    {g.description}
                  </div>
                ) : null}
              </div>
              <div className="row gap-6">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setForm({
                      id: g.id,
                      name: g.name,
                      description: g.description ?? '',
                      is_required: g.is_required,
                      is_multiple: g.is_multiple,
                      min_select: g.min_select,
                      max_select: g.max_select,
                      sort_order: g.sort_order,
                      is_active: g.is_active,
                      items: g.items.map((i) => ({
                        id: i.id,
                        name: i.name,
                        price_delta: String(i.price_delta),
                        is_default: i.is_default,
                        is_active: i.is_active,
                      })),
                    })
                  }
                  type="button"
                >
                  Sửa
                </button>
                <button className="btn btn-ghost btn-sm danger-text" onClick={() => setDeleting(g)} type="button">
                  Xoá
                </button>
              </div>
            </div>
            <div className="g-items">
              {g.items.length === 0 ? (
                <div className="muted small">Nhóm chưa có lựa chọn nào.</div>
              ) : (
                <div className="row wrap gap-6">
                  {g.items.map((i) => (
                    <span key={i.id} className={`badge ${i.is_active ? '' : 'badge-danger'}`} style={{ padding: '5px 10px' }}>
                      {i.is_default ? '⭐ ' : ''}
                      {i.name}
                      {Number(i.price_delta) !== 0 ? (
                        <strong style={{ marginLeft: 5 }}>{Number(i.price_delta) > 0 ? '+' : ''}{formatMoney(i.price_delta)}</strong>
                      ) : null}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </AsyncBlock>

      {/* ---- Form nhóm ---- */}
      <Modal
        open={!!form}
        size="lg"
        title={form?.id ? `Sửa nhóm: ${form.name}` : 'Thêm nhóm lựa chọn'}
        onClose={() => setForm(null)}
        footer={
          <ModalFooter
            busy={busy}
            onCancel={() => setForm(null)}
            onConfirm={save}
            confirmLabel={form?.id ? 'Lưu' : 'Tạo nhóm'}
          />
        }
      >
        {form ? (
          <>
            {errors.length > 0 ? (
              <div className="alert alert-error">
                {errors.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            ) : null}

            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div className="field grow">
                <label htmlFor="gn">Tên nhóm *</label>
                <input id="gn" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VD: Nhân thêm" />
              </div>
              <div className="field" style={{ width: 110 }}>
                <label htmlFor="gso">Thứ tự</label>
                <input id="gso" className="input" type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="gd">Mô tả cho khách</label>
              <input id="gd" className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="VD: Chọn thêm nhân cho bánh mì" />
            </div>

            <div className="field">
              <label>Kiểu chọn</label>
              <div className="row wrap" style={{ gap: 18 }}>
                <label className="checkbox">
                  <input type="checkbox" checked={form.is_multiple} onChange={(e) => setForm({ ...form, is_multiple: e.target.checked, max_select: e.target.checked ? Math.max(2, form.max_select) : 1 })} />
                  Cho phép chọn nhiều
                </label>
                <label className="checkbox">
                  <input type="checkbox" checked={form.is_required} onChange={(e) => setForm({ ...form, is_required: e.target.checked, min_select: e.target.checked ? Math.max(1, form.min_select) : 0 })} />
                  Khách bắt buộc phải chọn
                </label>
                <label className="checkbox">
                  <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                  Đang bật
                </label>
              </div>
            </div>

            <div className="row gap-12">
              <div className="field grow">
                <label htmlFor="gmin">Số lượng tối thiểu</label>
                <input id="gmin" className="input" type="number" min={0} value={form.min_select} onChange={(e) => setForm({ ...form, min_select: Number(e.target.value) })} />
              </div>
              <div className="field grow">
                <label htmlFor="gmax">Số lượng tối đa</label>
                <input
                  id="gmax"
                  className="input"
                  type="number"
                  min={1}
                  value={form.max_select}
                  disabled={!form.is_multiple}
                  onChange={(e) => setForm({ ...form, max_select: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="field">
              <label>Các lựa chọn trong nhóm *</label>
              <div className="col" style={{ gap: 7 }}>
                {form.items.map((it, idx) => (
                  <div className="g-item-row" key={idx}>
                    <span className="o-line-qty" style={{ minWidth: 26 }}>
                      {idx + 1}
                    </span>
                    <input
                      className="input"
                      value={it.name}
                      onChange={(e) => {
                        const items = [...form.items];
                        items[idx] = { ...it, name: e.target.value };
                        setForm({ ...form, items });
                      }}
                      placeholder="VD: Thịt nướng"
                    />
                    <input
                      className="input num"
                      value={it.price_delta}
                      onChange={(e) => {
                        const items = [...form.items];
                        items[idx] = { ...it, price_delta: e.target.value.replace(/\D/g, '').slice(0, 10) };
                        setForm({ ...form, items });
                      }}
                      placeholder="+0đ"
                    />
                    <label className="checkbox" style={{ whiteSpace: 'nowrap' }}>
                      <input
                        type="checkbox"
                        checked={it.is_default}
                        onChange={(e) => {
                          const items = [...form.items];
                          items[idx] = { ...it, is_default: e.target.checked };
                          setForm({ ...form, items });
                        }}
                      />
                      Mặc định
                    </label>
                    <button
                      className="btn btn-ghost btn-sm danger-text"

                      onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })}
                      type="button"
                      title="Xoá lựa chọn"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button className="btn btn-ghost btn-sm mt-8" onClick={() => setForm({ ...form, items: [...form.items, newItem()] })} type="button">
                + Thêm lựa chọn
              </button>
              <div className="tiny muted mt-6">
                Ô giá là số tiền <strong>cộng thêm</strong> (VD: 15000 = +15.000đ). Ghi 0 nếu miễn phí.
              </div>
            </div>
          </>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        danger
        title="Xoá nhóm lựa chọn"
        confirmLabel="Xoá"
        busy={busy}
        message={
          <div>
            Xoá nhóm <strong>{deleting?.name}</strong> và {deleting?.items.length} lựa chọn?
            {deleting && deleting.dish_count > 0 ? (
              <div className="small danger-text mt-8">
                ⚠️ Nhóm này đang được gán cho {deleting.dish_count} món. Hãy gỡ khỏi các món đó trước.
              </div>
            ) : null}
          </div>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      />
    </AppLayout>
  );
}
