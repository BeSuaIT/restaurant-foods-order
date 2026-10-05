import { useState } from 'react';
import { AsyncBlock, ModalFooter } from '../../components/PageParts';
import { api } from '../../lib/http';
import { formatDateTime } from '../../lib/format';
import { useAsync } from '../../hooks/useAsync';
import { ADMIN_SECTIONS, AppLayout } from '../../components/AppLayout';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import type { AdminUser, Branch, UserRole } from '../../types';

interface FormState {
  id?: number;
  username: string;
  password: string;
  full_name: string;
  role: UserRole;
  phone: string;
  note: string;
  branch_id: number | null;
  is_active: boolean;
}

const emptyForm = (): FormState => ({
  username: '',
  password: '',
  full_name: '',
  role: 'staff',
  phone: '',
  note: '',
  branch_id: null,
  is_active: true,
});

/**
 * QUẢN LÝ TÀI KHOẢN — chỉ Admin được vào.
 * Mục đích: khi in bill / kiểm tra lịch sử order biết hôm đó ai phục vụ bàn nào.
 * Mỗi nhân viên được gán vào 1 cơ sở và chỉ thấy đơn/bàn của cơ sở đó.
 */
export function AdminUsers() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | UserRole>('');
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [newPass, setNewPass] = useState('');

  const branches = useAsync<Branch[]>((signal) => api.get<Branch[]>('/admin/branches', { signal }), []);
  const branchList = branches.data ?? [];
  const state = useAsync<AdminUser[]>((signal) => api.get<AdminUser[]>('/admin/users', { signal }), []);

  const save = async () => {
    if (!form) return;
    setErrors([]);
    setBusy(true);
    try {
      const body = {
        full_name: form.full_name,
        role: form.role,
        phone: form.phone || null,
        note: form.note || null,
        // Nhân viên phải có cơ sở; Admin để trống = xem tất cả cơ sở
        branch_id: form.role === 'staff' ? form.branch_id : null,
        is_active: form.is_active,
        ...(form.id ? {} : { username: form.username, password: form.password }),
        ...(form.id && form.password ? { password: form.password } : {}),
      };

      if (form.id) {
        await api.patch(`/admin/users/${form.id}`, body);
        toast.success('Đã cập nhật tài khoản.');
      } else {
        await api.post('/admin/users', body);
        toast.success(`Đã tạo tài khoản "${form.username}".`);
      }
      setForm(null);
      state.reload();
    } catch (err) {
      const e = err as { details?: { message?: string }[]; message?: string };
      if (Array.isArray(e.details) && e.details.length) {
        setErrors(e.details.map((d) => d.message ?? 'Dữ liệu không hợp lệ'));
      } else {
        setErrors([e.message ?? 'Không lưu được.']);
      }
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/admin/users/${deleting.id}`);
      toast.success(`Đã xoá tài khoản "${deleting.username}".`);
      setDeleting(null);
      state.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không xoá được.');
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    if (!resetting) return;
    if (newPass.length < 4) {
      setErrors(['Mật khẩu mới tối thiểu 4 ký tự.']);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      await api.post(`/admin/users/${resetting.id}/reset-password`, { password: newPass });
      toast.success(`Đã đặt lại mật khẩu cho "${resetting.username}".`);
      setResetting(null);
      setNewPass('');
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Không đặt lại được.']);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (u: AdminUser) => {
    try {
      await api.patch(`/admin/users/${u.id}`, { is_active: !u.is_active });
      toast.success(u.is_active ? `Đã vô hiệu hoá "${u.username}".` : `Đã kích hoạt "${u.username}".`);
      state.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không cập nhật được.');
    }
  };

  const rows = (state.data ?? []).filter((u) => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return u.username.toLowerCase().includes(s) || u.full_name.toLowerCase().includes(s);
  });

  return (
    <AppLayout
      role="admin"
      sections={ADMIN_SECTIONS}
      title="Quản lý tài khoản"
      subtitle="Chỉ Admin được tạo và quản lý tài khoản đăng nhập"
      actions={
        <button className="btn btn-sm" onClick={() => { setForm(emptyForm()); setErrors([]); }} type="button">
          + Thêm tài khoản
        </button>
      }
    >
      <div className="alert alert-info">
        ℹ️ Tài khoản <strong>không có chức năng đăng ký</strong> — mọi tài khoản đều do Admin cấp.
        Thông tin người nhận order và người thanh toán được ghi lại để in bill & tra cứu lịch sử.
      </div>

      <div className="s-filters">
        <div className="field grow" style={{ maxWidth: 300 }}>
          <label htmlFor="q">Tìm kiếm</label>
          <input id="q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên hoặc tài khoản..." />
        </div>
        <div className="field">
          <label htmlFor="rf">Vai trò</label>
          <select id="rf" className="select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as '' | UserRole)}>
            <option value="">Tất cả</option>
            <option value="staff">Nhân viên</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>

      <AsyncBlock
        loading={state.loading}
        error={state.error}
        loadingText="Đang tải..."
        empty={rows.length === 0 ? (
          <div className="empty">
            <div className="icon">👥</div>
            <div>Không tìm thấy tài khoản</div>
          </div>
        ) : undefined}
      >
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Tài khoản</th>
                <th>Họ tên</th>
                <th>Vai trò</th>
                <th>Cơ sở</th>
                <th>SĐT</th>
                <th className="right">Đã nhận</th>
                <th className="right">Đã thu tiền</th>
                <th>Đăng nhập cuối</th>
                <th>Trạng thái</th>
                <th className="right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td className="mono strong">{u.username}</td>
                  <td className="nowrap">
                    <div>{u.full_name}</div>
                    {u.note ? <div className="tiny muted">{u.note}</div> : null}
                  </td>
                  <td>
                    <span className={`badge ${u.role === 'admin' ? 'badge-danger' : 'badge-info'}`}>
                      {u.role === 'admin' ? 'Admin' : 'Nhân viên'}
                    </span>
                  </td>
                  <td className="small nowrap">
                    {u.role === 'admin' ? (
                      <span className="muted">Tất cả cơ sở</span>
                    ) : u.branch_name ? (
                      <>🏢 {u.branch_name}</>
                    ) : (
                      <span className="badge badge-warn">Chưa gán</span>
                    )}
                  </td>
                  <td className="small nowrap">{u.phone ?? '—'}</td>
                  <td className="right">{u.received_orders}</td>
                  <td className="right">{u.paid_orders}</td>
                  <td className="tiny muted nowrap">{u.last_login_at ? formatDateTime(u.last_login_at) : 'Chưa'}</td>
                  <td>
                    <span className={`badge ${u.is_active ? 'badge-ok' : 'badge-danger'}`}>
                      {u.is_active ? 'Hoạt động' : 'Đã khoá'}
                    </span>
                  </td>
                  <td>
                    <div className="row row-end">
                      <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ ...emptyForm(), id: u.id, username: u.username, full_name: u.full_name, role: u.role, phone: u.phone ?? '', note: u.note ?? '', branch_id: u.branch_id, is_active: u.is_active, password: '' }); setErrors([]); }} type="button">
                        Sửa
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setResetting(u); setNewPass(''); setErrors([]); }} type="button">
                        🔑
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => void toggleActive(u)} type="button">
                        {u.is_active ? 'Khoá' : 'Mở'}
                      </button>
                      <button className="btn btn-ghost btn-sm danger-text" onClick={() => setDeleting(u)} type="button">
                        Xoá
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AsyncBlock>

      {/* ---- Form tài khoản ---- */}
      <Modal
        open={!!form}
        title={form?.id ? `Sửa tài khoản: ${form.username}` : 'Tạo tài khoản mới'}
        onClose={() => setForm(null)}
        footer={<ModalFooter onCancel={() => setForm(null)} onConfirm={save} busy={busy} confirmLabel={form?.id ? 'Lưu thay đổi' : 'Tạo tài khoản'} />}
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
                <label htmlFor="fu">Tài khoản *</label>
                <input
                  id="fu"
                  className="input"
                  value={form.username}
                  disabled={!!form.id}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="VD: nhanvien01"
                />
              </div>
              <div className="field grow">
                <label htmlFor="fr">Vai trò *</label>
                <select id="fr" className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
                  <option value="staff">Nhân viên (nhận order + thu tiền)</option>
                  <option value="admin">Admin (toàn quyền, xem mọi cơ sở, cũng nhận order được)</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="fn">Họ và tên *</label>
              <input id="fn" className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Nguyễn Văn A" />
            </div>

            <div className="field">
              <label htmlFor="fb">
                Cơ sở làm việc {form.role === 'staff' ? '*' : ''}
              </label>
              {form.role === 'admin' ? (
                <>
                  <select id="fb" className="select" value="" disabled>
                    <option>Tất cả cơ sở (Admin)</option>
                  </select>
                  <div className="tiny muted mt-4">
                    Admin xem &amp; thao tác được tất cả cơ sở, nên không gán cơ sở cụ thể.
                  </div>
                </>
              ) : (
                <>
                  <select
                    id="fb"
                    className="select"
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
                  <div className="tiny muted mt-4">
                    Nhân viên chỉ thấy đơn &amp; bàn của cơ sở được gán.
                  </div>
                </>
              )}
            </div>

            <div className="field">
              <label htmlFor="fp">
                {form.id ? 'Mật khẩu mới' : 'Mật khẩu *'}{' '}
                <span className="hint">{form.id ? '(để trống nếu không đổi)' : '(tối thiểu 4 ký tự)'}</span>
              </label>
              <input id="fp" className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
            </div>

            <div className="row gap-12">
              <div className="field grow">
                <label htmlFor="fph">Số điện thoại</label>
                <input id="fph" className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0900 000 000" />
              </div>
              <div className="field grow">
                <label htmlFor="fno">Ghi chú</label>
                <input id="fno" className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="VD: Nhân viên thu ngân" />
              </div>
            </div>

            <label className="checkbox">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Tài khoản đang hoạt động (cho phép đăng nhập)
            </label>
          </>
        ) : null}
      </Modal>

      {/* ---- Reset mật khẩu ---- */}
      <Modal
        open={!!resetting}
        title="Đặt lại mật khẩu"
        onClose={() => setResetting(null)}
        footer={
          <ModalFooter
            busy={busy}
            onCancel={() => setResetting(null)}
            onConfirm={doReset}
            confirmLabel="Đặt lại"
          />
        }
      >
        <p className="small">
          Đặt mật khẩu mới cho tài khoản <strong>{resetting?.username}</strong> ({resetting?.full_name}).
        </p>
        {errors.length > 0 ? <div className="alert alert-error">{errors.join(', ')}</div> : null}
        <div className="field">
          <label htmlFor="np">Mật khẩu mới *</label>
          <input id="np" className="input" type="text" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="Tối thiểu 4 ký tự" autoComplete="new-password" />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        danger
        title="Xoá tài khoản"
        confirmLabel="Xoá"
        busy={busy}
        message={
          <div>
            Xoá tài khoản <strong>{deleting?.username}</strong> ({deleting?.full_name})?
            <div className="small muted mt-8">
              Lịch sử order đã ghi nhận vẫn được giữ nguyên. Nếu chỉ muốn ngăn đăng nhập, hãy dùng nút “Khoá”.
            </div>
          </div>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={doDelete}
      />
    </AppLayout>
  );
}
