import { useState } from 'react';
import { AsyncBlock, ModalFooter } from '../../components/PageParts';
import { api, tokenStore } from '../../lib/http';
import { useAsync } from '../../hooks/useAsync';
import { useLiveStream } from '../../hooks/useLiveStream';
import { ADMIN_SECTIONS, AppLayout } from '../../components/AppLayout';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { RichEditor, RichView } from '../../components/RichText';
import { useToast } from '../../components/Toast';
import type { Announcement } from '../../types';

/* ================================================================== *
 *  THÔNG BÁO NỘI BỘ — chỉ Admin
 *
 *  Soạn thông báo (tiêu đề + nội dung định dạng + ảnh) rồi đăng cho toàn bộ
 *  nhân viên. Mỗi thông báo hiển thị ở trang "Thông báo" của nhân viên và popup
 *  lên 1 lần khi họ vừa đăng nhập.
 * ================================================================== */

interface FormState {
  id?: number;
  title: string;
  content: string;
  image_url: string;
  is_published: boolean;
}

const emptyForm = (): FormState => ({
  title: '',
  content: '',
  image_url: '',
  is_published: true,
});

/** Ngày giờ -> giá trị cho <input type="datetime-local"> */
const toLocalInput = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function AdminAnnouncements() {
  const toast = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<Announcement | null>(null);

  const state = useAsync<Announcement[]>((signal) => api.get<Announcement[]>('/admin/announcements', { signal }), []);

  // Có người đăng/gỡ thông báo ở máy khác -> cập nhật danh sách
  useLiveStream(tokenStore.getStaffToken(), (e) => {
    if (e.type === 'announcement.updated') state.reload();
  });

  const save = async () => {
    if (!form) return;
    const title = form.title.trim();
    const plain = form.content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (title.length < 3) return toast.error('Tiêu đề thông báo tối thiểu 3 ký tự.');
    if (!plain && !form.image_url.trim()) return toast.error('Cần có nội dung hoặc hình ảnh.');

    setBusy(true);
    try {
      const payload = {
        title,
        content: form.content,
        image_url: form.image_url.trim() || null,
        is_published: form.is_published,
      };
      if (form.id) {
        await api.patch(`/admin/announcements/${form.id}`, payload);
        toast.success('Đã cập nhật thông báo.');
      } else {
        await api.post('/admin/announcements', payload);
        toast.success(form.is_published ? 'Đã đăng thông báo cho nhân viên.' : 'Đã lưu thông báo (chưa đăng).');
      }
      setForm(null);
      state.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lưu thông báo thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const togglePublish = async (a: Announcement) => {
    try {
      await api.patch(`/admin/announcements/${a.id}`, {
        title: a.title,
        content: a.content,
        image_url: a.image_url,
        is_published: !a.is_published,
      });
      toast.success(a.is_published ? 'Đã gỡ đăng.' : 'Đã đăng lại cho nhân viên.');
      state.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không cập nhật được.');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await api.del<{ deleted: boolean; message?: string }>(`/admin/announcements/${deleting.id}`);
      toast.success(res.message ?? 'Đã xoá thông báo.');
      setDeleting(null);
      state.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không xoá được.');
    } finally {
      setBusy(false);
    }
  };

  /** Tải ảnh lên server rồi điền vào ô đường dẫn */
  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload/image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenStore.getStaffToken() ?? ''}` },
        body: fd,
      });
      const j = (await res.json()) as { data?: { url?: string }; message?: string };
      if (!res.ok || !j.data?.url) throw new Error(j.message ?? 'Tải ảnh lên thất bại.');
      setForm((f) => (f ? { ...f, image_url: j.data!.url! } : f));
      toast.success('Đã tải ảnh lên.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Tải ảnh lên thất bại.');
    } finally {
      setUploading(false);
    }
  };

  const rows = state.data ?? [];

  return (
    <AppLayout
      role="admin"
      sections={ADMIN_SECTIONS}
      title="Thông báo nội bộ"
      subtitle={`${rows.length} thông báo · ${rows.filter((a) => a.is_published).length} đang đăng`}
      actions={
        <button className="btn" onClick={() => setForm(emptyForm())} type="button">
          ✚ Soạn thông báo
        </button>
      }
    >
      <AsyncBlock
        loading={state.loading}
        error={state.error}
        loadingText="Đang tải thông báo..."
        empty={rows.length === 0 ? (
          <div className="empty">
            <div className="icon">📣</div>
            <div className="strong">Chưa có thông báo nào</div>
            <div className="small">
              Dùng để thông báo sự kiện, thay đổi lịch, sự cố... cho toàn bộ nhân viên.
            </div>
            <button className="btn" onClick={() => setForm(emptyForm())} type="button">
              ✚ Soạn thông báo đầu tiên
            </button>
          </div>
        ) : undefined}
      >
        <div className="note-list">
          {rows.map((a) => (
            <article className={`note admin ${a.is_published ? '' : 'unpublished'}`} key={a.id}>
              <div className="note-head static">
                <div className="grow minw-0">
                  <div className="note-title">
                    {a.title}
                    <span className={`badge ${a.is_published ? 'badge-success' : 'badge-muted'}`}>
                      {a.is_published ? 'Đang đăng' : 'Nháp'}
                    </span>
                  </div>
                  <div className="tiny muted">
                    📢 {a.created_by_name ?? 'Admin'} · đăng {toLocalInput(a.published_at).replace('T', ' ')} · 🔍{' '}
                    {a.read_count ?? 0} người đã đọc
                  </div>
                </div>
              </div>

              {a.image_url ? <img className="note-img" src={a.image_url} alt={a.title} loading="lazy" /> : null}

              <RichView html={a.content} className="note-body" />

              <div className="note-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    setForm({
                      id: a.id,
                      title: a.title,
                      content: a.content,
                      image_url: a.image_url ?? '',
                      is_published: a.is_published,
                    })
                  }
                  type="button"
                >
                  ✎ Sửa
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => void togglePublish(a)} type="button">
                  {a.is_published ? '👁 Gỡ đăng' : '📢 Đăng lại'}
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => setDeleting(a)} type="button">
                  🗑 Xoá
                </button>
              </div>
            </article>
          ))}
        </div>
      </AsyncBlock>

      {/* ---------------- Modal soạn / sửa ---------------- */}
      <Modal
        open={!!form}
        title={form?.id ? 'Sửa thông báo' : 'Soạn thông báo mới'}
        onClose={() => setForm(null)}
        size="lg"
        footer={
          <ModalFooter
            busy={busy}
            onCancel={() => setForm(null)}
            onConfirm={() => void save()}
            confirmLabel={form?.is_published ? '📢 Đăng cho nhân viên' : '💾 Lưu nháp'}
          />
        }
      >
        {form ? (
          <>
            <div className="field">
              <label htmlFor="nt-title">Tiêu đề</label>
              <input
                id="nt-title"
                className="input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="VD: Khai giảng cơ sở Phía Nam ngày 20/11"
                maxLength={200}
              />
            </div>

            <div className="field">
              <label id="nt-content">Nội dung</label>
              <RichEditor
                labelId="nt-content"
                value={form.content}
                onChange={(html) => setForm((f) => (f ? { ...f, content: html } : f))}
                placeholder="Nội dung thông báo cho nhân viên..."
              />
            </div>

            <div className="field">
              <label htmlFor="nt-image">Hình ảnh</label>
              <div className="row">
                <input
                  id="nt-image"
                  className="input grow"
                  value={form.image_url}
                  onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                  placeholder="Đường dẫn ảnh, hoặc bấm Chọn ảnh..."
                />
                <label className="btn btn-secondary btn-sm">
                  {uploading ? 'Đang tải...' : '🖼 Chọn ảnh'}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadImage(f);
                      e.target.value = '';
                    }}
                  />
                </label>
                {form.image_url ? (
                  <button className="btn btn-secondary btn-sm" onClick={() => setForm({ ...form, image_url: '' })} type="button">
                    ✕ Bỏ ảnh
                  </button>
                ) : null}
              </div>
              {form.image_url ? (
                <img className="note-preview" src={form.image_url} alt="Xem trước" />
              ) : null}
            </div>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.is_published}
                onChange={(e) => setForm({ ...form, is_published: e.target.checked })}
              />
              <span>
                Đăng ngay cho nhân viên
                <div className="tiny muted">
                  Bỏ chọn để lưu nháp, nhân viên sẽ chưa thấy. Khi đăng, thông báo mới sẽ hiện popup ở lần
                  đăng nhập kế tiếp của nhân viên.
                </div>
              </span>
            </label>
          </>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Xoá thông báo?"
        message={
          deleting?.read_count
            ? `Thông báo "${deleting.title}" đã có ${deleting.read_count} người đọc nên chỉ được gỡ đăng (ẩn khỏi danh sách nhân viên), không xoá hẳn. Bạn có muốn gỡ đăng?`
            : `Xoá vĩnh viễn thông báo "${deleting?.title}"? Thao tác này không hoàn tác được.`
        }
        confirmLabel={deleting?.read_count ? 'Gỡ đăng' : 'Xoá'}
        danger
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </AppLayout>
  );
}