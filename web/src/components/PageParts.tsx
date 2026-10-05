import type { ReactNode } from 'react';

/* ================================================================== *
 *  CÁC KHỐI DÙNG LẠI Ở NHIỀU TRANG
 *
 *  Trước đây mỗi trang tự viết lại: ô chọn cơ sở, khối
 *  đang-tải / lỗi / rỗng, và cặp nút Huỷ–Lưu trong modal. Cùng một
 *  khối markup lặp ở 6–9 file nên sửa style là phải sửa nhiều nơi.
 *  Gom vào đây để nhất quán và một chỗ duy nhất.
 * ================================================================== */

export interface BranchOption {
  id: number;
  name: string;
}

/**
 * Ô chọn cơ sở dùng ở thanh thao tác của các trang nhân viên/admin.
 * `branchFilter` là `''` nghĩa là tất cả cơ sở.
 */
export function BranchFilter({
  branchFilter,
  onChange,
  branches,
}: {
  branchFilter: number | '';
  onChange: (v: number | '') => void;
  branches: BranchOption[];
}) {
  return (
    <select className="input w-200" value={branchFilter === '' ? '' : String(branchFilter)} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}>
      <option value="">🏢 Tất cả cơ sở</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          🏢 {b.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Trạng thái của một vùng dữ liệu: đang tải → lỗi → rỗng → nội dung.
 * `empty` nhận sẵn node rỗng của từng trang (nội dung rỗng khác nhau: icon,
 * gợi ý, nút thao tác) nên phần điều kiện chỉ viết một lần ở đây.
 */
export function AsyncBlock({
  loading,
  error,
  empty,
  loadingText = 'Đang tải...',
  children,
}: {
  loading: boolean;
  error: string | null;
  empty?: ReactNode;
  loadingText?: string;
  children: ReactNode;
}) {
  if (loading) return <div className="loading-box">{loadingText}</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (empty) return <>{empty}</>;
  return <>{children}</>;
}

/**
 * Cặp nút Huỷ / Xác nhận ở chân modal.
 * `confirmLabel` nên ghi rõ hành động ("Lưu", "Tạo mã") để tránh nút chung chung.
 */
export function ModalFooter({
  onCancel,
  onConfirm,
  busy,
  confirmLabel = 'Lưu',
  cancelLabel = 'Huỷ',
  danger,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}) {
  return (
    <>
      <button className="btn btn-secondary" onClick={onCancel} disabled={busy} type="button">
        {cancelLabel}
      </button>
      <button className={`btn ${danger ? 'btn-danger' : ''}`} onClick={onConfirm} disabled={busy} type="button">
        {busy && <span className="spinner" />}
        {confirmLabel}
      </button>
    </>
  );
}