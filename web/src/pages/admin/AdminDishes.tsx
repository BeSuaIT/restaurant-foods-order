import { useMemo, useRef, useState } from 'react';
import { AsyncBlock, ModalFooter } from '../../components/PageParts';
import { api, tokenStore } from '../../lib/http';
import { formatMoney } from '../../lib/format';
import { useAsync } from '../../hooks/useAsync';
import { useLiveStream } from '../../hooks/useLiveStream';
import { ADMIN_SECTIONS, AppLayout } from '../../components/AppLayout';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import type { DishAdmin, OptionGroupFull } from '../../types';

/* ================================================================== *
 *  Form món ăn
 * ================================================================== */

interface DishForm {
  id?: number;
  name: string;
  description: string;
  category: string;
  image_url: string;
  price: string;
  is_available: boolean;
  is_active: boolean;
  sort_order: number;
  option_group_ids: number[];
}

const emptyDish = (): DishForm => ({
  name: '',
  description: '',
  category: '',
  image_url: '',
  price: '0',
  is_available: true,
  is_active: true,
  sort_order: 0,
  option_group_ids: [],
});

/* ================================================================== *
 *  QUẢN LÝ MÓN ĂN — chỉ Admin
 * ================================================================== */

export function AdminDishes() {
  const toast = useToast();
  const [form, setForm] = useState<DishForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<DishAdmin | null>(null);
  const [cat, setCat] = useState('');
  const [search, setSearch] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const dishes = useAsync<DishAdmin[]>((signal) => api.get<DishAdmin[]>('/admin/dishes', { signal }), []);
  const groups = useAsync<OptionGroupFull[]>((signal) => api.get<OptionGroupFull[]>('/admin/option-groups', { signal }), []);

  useLiveStream(tokenStore.getStaffToken(), (e) => {
    if (e.type === 'menu.updated') {
      dishes.reload();
      groups.reload();
    }
  });

  const all = dishes.data ?? [];
  const groupList = groups.data ?? [];

  const categories = useMemo(() => [...new Set(all.map((d) => d.category).filter(Boolean))] as string[], [all]);

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return all.filter((d) => {
      if (cat && d.category !== cat) return false;
      if (!s) return true;
      return d.name.toLowerCase().includes(s) || (d.description ?? '').toLowerCase().includes(s);
    });
  }, [all, cat, search]);

  const groupById = useMemo(() => new Map(groupList.map((g) => [g.id, g])), [groupList]);

  const save = async () => {
    if (!form) return;
    setErrors([]);
    if (form.name.trim().length < 1) {
      setErrors(['Vui lòng nhập tên món.']);
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name,
        description: form.description || null,
        category: form.category || null,
        image_url: form.image_url || null,
        price: Number(form.price.replace(/\D/g, '')) || 0,
        is_available: form.is_available,
        is_active: form.is_active,
        sort_order: Number(form.sort_order) || 0,
        option_group_ids: form.option_group_ids,
      };
      if (form.id) {
        await api.patch(`/admin/dishes/${form.id}`, body);
        toast.success('Đã cập nhật món ăn.');
      } else {
        await api.post('/admin/dishes', body);
        toast.success(`Đã thêm món "${form.name}".`);
      }
      setForm(null);
      dishes.reload();
    } catch (err) {
      const e = err as { details?: { message?: string }[]; message?: string };
      setErrors(
        Array.isArray(e.details) && e.details.length ? e.details.map((d) => d.message ?? '') : [e.message ?? 'Không lưu được.'],
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleAvail = async (d: DishAdmin) => {
    try {
      await api.patch(`/admin/dishes/${d.id}/availability`, { is_available: !d.is_available });
      toast.success(d.is_available ? `Đã đánh dấu "${d.name}" hết món.` : `Đã cho "${d.name}" trở lại menu.`);
      dishes.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không cập nhật được.');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await api.del<{ soft_deleted?: boolean; message?: string }>(`/admin/dishes/${deleting.id}`);
      toast.success(res.message ?? 'Đã xoá món.');
      setDeleting(null);
      dishes.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không xoá được.');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    if (!form) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload/image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenStore.getStaffToken() ?? ''}` },
        body: fd,
      });
      const json = (await res.json()) as { data?: { url: string }; message?: string };
      if (!res.ok || !json.data) throw new Error(json.message ?? 'Upload thất bại');
      setForm({ ...form, image_url: json.data.url });
      toast.success('Đã tải ảnh lên.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const pickImage = (url: string) => form && setForm({ ...form, image_url: url });

  /** Chuyển đổi nhóm lựa chọn gắn với món */
  const toggleGroup = (gid: number) => {
    if (!form) return;
    const has = form.option_group_ids.includes(gid);
    setForm({
      ...form,
      option_group_ids: has ? form.option_group_ids.filter((x) => x !== gid) : [...form.option_group_ids, gid],
    });
  };

  const seedImages = all.filter((d) => d.image_url?.startsWith('/uploads/seed/')).map((d) => d.image_url!);

  return (
    <AppLayout
      role="admin"
      sections={ADMIN_SECTIONS}
      title="Quản lý món ăn"
      subtitle={`${all.length} món · ${all.filter((d) => !d.is_available).length} đang hết`}
      actions={
        <>
          <a className="btn btn-ghost btn-sm" href="/admin/option-groups" style={{ textDecoration: 'none' }}>
            ⚙️ Phần chọn đi kèm
          </a>
          <button className="btn btn-sm" onClick={() => { setForm(emptyDish()); setErrors([]); }} type="button">
            + Thêm món
          </button>
        </>
      }
    >
      <div className="alert alert-info">
        💡 Gán <strong>phần chọn đi kèm</strong> cho món để khi khách chọn món (VD: <em>bánh mì</em>) hệ thống hỏi thêm
        thịt, trứng, xúc xích… Mỗi lựa chọn có thể cộng thêm giá.
      </div>

      <div className="s-filters">
        <div className="field grow" style={{ maxWidth: 280 }}>
          <label htmlFor="dq">Tìm món</label>
          <input id="dq" className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tên món..." />
        </div>
        <div className="field">
          <label htmlFor="dc">Nhóm món</label>
          <select id="dc" className="select" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">Tất cả</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <AsyncBlock
        loading={dishes.loading}
        error={dishes.error}
        loadingText="Đang tải..."
        empty={visible.length === 0 ? (
          <div className="empty">
            <div className="icon">🍽️</div>
            <div>Chưa có món nào</div>
            <button className="btn mt-14" onClick={() => setForm(emptyDish())} type="button">
              + Thêm món đầu tiên
            </button>
          </div>
        ) : undefined}
      >
        <div className="d-grid">
          {visible.map((d) => (
            <div key={d.id} className={`d-card ${!d.is_active || !d.is_available ? 'd-off' : ''}`}>
              {d.image_url ? (
                <img src={d.image_url} alt={d.name} className="d-card-img" loading="lazy" />
              ) : (
                <div className="d-card-img ph">🍽️</div>
              )}
              <div className="d-card-body">
                <div className="strong small">{d.name}</div>
                <div className="c-price">{formatMoney(d.price)}</div>
                <div className="row wrap" style={{ gap: 4 }}>
                  {d.category ? <span className="badge">{d.category}</span> : null}
                  {!d.is_active ? <span className="badge badge-danger">Đã ẩn</span> : null}
                  {d.is_available ? null : <span className="badge badge-warn">Hết món</span>}
                </div>
                {d.option_group_ids.length > 0 ? (
                  <div className="row wrap" style={{ gap: 3 }}>
                    {d.option_group_ids.map((gid) => (
                      <span key={gid} className="c-opt-flag">
                        ⚙ {groupById.get(gid)?.name ?? `#${gid}`}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="d-card-foot">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setForm({
                      id: d.id,
                      name: d.name,
                      description: d.description ?? '',
                      category: d.category ?? '',
                      image_url: d.image_url ?? '',
                      price: String(d.price),
                      is_available: d.is_available,
                      is_active: d.is_active,
                      sort_order: d.sort_order,
                      option_group_ids: d.option_group_ids,
                    })
                  }
                  type="button"
                >
                  Sửa
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => void toggleAvail(d)} type="button">
                  {d.is_available ? 'Hết món' : 'Có món'}
                </button>
                <button className="btn btn-ghost btn-sm danger-text" onClick={() => setDeleting(d)} type="button">
                  Xoá
                </button>
              </div>
            </div>
          ))}
        </div>
      </AsyncBlock>

      {/* ---- Form món ---- */}
      <Modal
        open={!!form}
        size="lg"
        title={form?.id ? `Sửa món: ${form.name}` : 'Thêm món ăn'}
        onClose={() => setForm(null)}
        footer={<ModalFooter onCancel={() => setForm(null)} onConfirm={save} busy={busy} confirmLabel={form?.id ? 'Lưu' : 'Thêm món'} />}
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
                <label htmlFor="dn">Tên món *</label>
                <input id="dn" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VD: Bánh mì thịt nướng" />
              </div>
              <div className="field" style={{ width: 150 }}>
                <label htmlFor="dp">Giá (đ) *</label>
                <input id="dp" className="input" inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value.replace(/\D/g, '').slice(0, 12) })} />
              </div>
            </div>

            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div className="field grow">
                <label htmlFor="dc">Nhóm món</label>
                <input id="dc" className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} list="catlist" placeholder="VD: Ăn sáng, Món chính..." />
                <datalist id="catlist">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="field" style={{ width: 120 }}>
                <label htmlFor="dso">Thứ tự</label>
                <input id="dso" className="input" type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="dd">Mô tả</label>
              <textarea id="dd" className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Mô tả ngắn cho khách..." maxLength={500} />
            </div>

            {/* Ảnh */}
            <div className="field">
              <label>Ảnh món ăn</label>
              <div className="row" style={{ gap: 12, alignItems: 'flex-start', marginBottom: 8 }}>
                {form.image_url ? (
                  <img src={form.image_url} alt="" style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 9, border: '1px solid var(--line)', flex: 'none' }} />
                ) : (
                  <div style={{ width: 96, height: 72, borderRadius: 9, background: 'var(--muted-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flex: 'none' }}>
                    🍽️
                  </div>
                )}
                <div className="col grow gap-6">
                  <input className="input" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="Đường dẫn ảnh (URL)" />
                  <div className="row gap-6">
                    <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={busy} type="button">
                      📤 Tải ảnh lên
                    </button>
                    {form.image_url ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, image_url: '' })} type="button">
                        Bỏ ảnh
                      </button>
                    ) : null}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload(f);
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>

              {seedImages.length > 0 ? (
                <>
                  <div className="tiny muted" style={{ marginBottom: 5 }}>
                    Ảnh mẫu có sẵn — bấm để dùng:
                  </div>
                  <div className="img-picker">
                    {seedImages.map((u) => (
                      <button key={u} type="button" className={`img-picker-item ${form.image_url === u ? 'selected' : ''}`} onClick={() => pickImage(u)} title="Chọn ảnh này">
                        <img src={u} alt="" loading="lazy" />
                        {form.image_url === u ? <span className="tick">✓</span> : null}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            {/* Phần chọn đi kèm */}
            <div className="field">
              <label>
                Phần chọn đi kèm{' '}
                <span className="hint">(khách sẽ được hỏi thêm khi chọn món này)</span>
              </label>
              {groups.loading ? (
                <div className="muted small">Đang tải...</div>
              ) : groupList.length === 0 ? (
                <div className="alert alert-warn" style={{ margin: 0 }}>
                  Chưa có nhóm lựa chọn nào.{' '}
                  <a href="/admin/option-groups" target="_blank" rel="noreferrer">
                    Tạo nhóm đầu tiên
                  </a>{' '}
                  (VD: “Nhân thêm”, “Sốt chấm”).
                </div>
              ) : (
                <div className="col gap-6">
                  {groupList.map((g) => {
                    const on = form.option_group_ids.includes(g.id);
                    return (
                      <label key={g.id} className="checkbox" style={{ padding: '8px 11px', border: `1.5px solid ${on ? 'var(--brand)' : 'var(--line)'}`, borderRadius: 9, background: on ? 'var(--brand-light)' : '#fff' }}>
                        <input type="checkbox" checked={on} onChange={() => toggleGroup(g.id)} />
                        <span className="grow">
                          <strong>{g.name}</strong>{' '}
                          <span className="badge">
                            {g.is_multiple ? `chọn nhiều (tối đa ${g.max_select})` : 'chọn 1'}
                          </span>
                          {g.is_required ? <span className="badge badge-danger">bắt buộc</span> : null}
                          <div className="tiny muted">
                            {g.items.length} lựa chọn:{' '}
                            {g.items
                              .slice(0, 5)
                              .map((i) => i.name)
                              .join(', ')}
                            {g.items.length > 5 ? '…' : ''}
                          </div>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="row" style={{ gap: 18 }}>
              <label className="checkbox">
                <input type="checkbox" checked={form.is_available} onChange={(e) => setForm({ ...form, is_available: e.target.checked })} />
                Còn món (đang bán)
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                Hiển thị trong menu
              </label>
            </div>
          </>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        danger
        title="Xoá món ăn"
        confirmLabel="Xoá"
        busy={busy}
        message={
          <div>
            Xoá món <strong>{deleting?.name}</strong>?
            <div className="small muted mt-8">
              Nếu món đã từng được order, hệ thống sẽ <strong>ẩn khỏi menu</strong> thay vì xoá để giữ nguyên lịch sử.
            </div>
          </div>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      />
    </AppLayout>
  );
}
