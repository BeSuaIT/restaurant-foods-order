import { query, queryOne } from '../db.js';
import { conflict, notFound } from '../utils.js';
import { htmlToText, sanitizeHtml } from '../sanitize.js';
import type { Announcement, AnnouncementWithRead } from '../types.js';

/* ------------------------------------------------------------------ *
 *  THÔNG BÁO NỘI BỘ
 *
 *  Admin soạn thông báo (tiêu đề + nội dung định dạng + ảnh) rồi đăng.
 *  Nhân viên xem ở trang "Thông báo", có số đếm chưa đọc trên sidebar.
 *  Khi có thông báo mới và vừa đăng nhập -> popup 1 lần để nhân viên đọc.
 *
 *  Nội dung HTML luôn được lọc ở đây (kể cả khi đọc ra) nên giao diện render
 *  bằng dangerouslySetInnerHTML là an toàn.
 * ------------------------------------------------------------------ */

const COLUMNS =
  'id, title, content, image_url, is_published, published_at, created_by, created_by_name, created_at, updated_at';

/** Cùng danh sách cột nhưng có tiền tố bảng (dùng khi query có JOIN). */
const A_COLUMNS = COLUMNS.split(', ').map((c) => `a.${c}`).join(', ');

/** Chuẩn hoá bản ghi đọc ra (luôn lọc lại nội dung). */
const shape = (r: Announcement): Announcement => ({ ...r, content: sanitizeHtml(r.content) });

export interface AnnouncementInput {
  title: string;
  content: string;
  image_url: string | null;
  is_published: boolean;
  /** null = dùng thời điểm hiện tại */
  published_at?: string | null;
}

/** Kiểm tra dữ liệu đầu vào và trả về bản đã chuẩn hoá. */
export function parseAnnouncementInput(raw: unknown): Required<Omit<AnnouncementInput, 'published_at'>> & {
  published_at: string | null;
} {
  const title = String((raw as { title?: unknown })?.title ?? '')
    .trim()
    .slice(0, 200);
  if (title.length < 3) throw conflict('Tiêu đề thông báo quá ngắn (tối thiểu 3 ký tự).');

  const content = sanitizeHtml((raw as { content?: unknown })?.content ?? '');
  const imageUrl = String((raw as { image_url?: unknown })?.image_url ?? '').trim() || null;

  const publishedRaw = (raw as { published_at?: unknown })?.published_at;
  let published_at: string | null = null;
  if (publishedRaw !== undefined && publishedRaw !== null && publishedRaw !== '') {
    const d = new Date(String(publishedRaw));
    if (Number.isNaN(d.getTime())) throw conflict('Thời gian đăng thông báo không hợp lệ.');
    published_at = d.toISOString();
  }

  return {
    title,
    content,
    image_url: imageUrl,
    is_published: (raw as { is_published?: unknown })?.is_published !== false,
    published_at,
  };
}

/* ------------------------------------------------------------------ *
 *  Admin: CRUD
 * ------------------------------------------------------------------ */

/** Tất cả thông báo (kể cả chưa đăng) — dành cho trang quản trị. */
export async function listAnnouncementsAdmin(): Promise<(Announcement & { read_count: number })[]> {
  const rows = await query<Announcement & { read_count: number }>(
    `SELECT ${COLUMNS},
            (SELECT COUNT(*)::int FROM announcement_reads r WHERE r.announcement_id = a.id) AS read_count
       FROM announcements a
      ORDER BY a.is_published DESC, a.published_at DESC, a.id DESC`,
  );
  return rows.map((r) => ({ ...shape(r), read_count: Number(r.read_count) }));
}

export async function createAnnouncement(
  input: ReturnType<typeof parseAnnouncementInput>,
  author: { id: number; full_name: string },
): Promise<Announcement> {
  const rows = await query<Announcement>(
    `INSERT INTO announcements (title, content, image_url, is_published, published_at, created_by, created_by_name)
     VALUES ($1,$2,$3,$4, COALESCE($5::timestamptz, NOW()), $6,$7)
     RETURNING ${COLUMNS}`,
    [input.title, input.content, input.image_url, input.is_published, input.published_at, author.id, author.full_name],
  );
  return shape(rows[0]);
}

export async function updateAnnouncement(
  id: number,
  input: ReturnType<typeof parseAnnouncementInput>,
): Promise<Announcement> {
  const rows = await query<Announcement>(
    `UPDATE announcements
        SET title=$2, content=$3, image_url=$4, is_published=$5,
            published_at = CASE
              WHEN $6::timestamptz IS NOT NULL THEN $6::timestamptz
              WHEN published_at IS NULL THEN NOW()
              ELSE published_at END
      WHERE id=$1
      RETURNING ${COLUMNS}`,
    [id, input.title, input.content, input.image_url, input.is_published, input.published_at],
  );
  if (rows.length === 0) throw notFound('Không tìm thấy thông báo.');
  return shape(rows[0]);
}

/**
 * Xoá thông báo.
 * - Đã có người đọc -> chỉ gỡ đăng (giữ dữ liệu để không mất lịch sử "đã đọc").
 * - Chưa ai đọc -> xoá hẳn cùng các bản ghi đã đọc (ON DELETE CASCADE).
 */
export async function deleteAnnouncement(id: number): Promise<{ deleted: boolean; soft_deleted?: boolean; message?: string }> {
  const row = await queryOne<{ read_count: number }>(
    'SELECT COUNT(*)::int AS read_count FROM announcement_reads WHERE announcement_id = $1',
    [id],
  );
  if ((row?.read_count ?? 0) > 0) {
    const updated = await query('UPDATE announcements SET is_published = FALSE WHERE id = $1 RETURNING id', [id]);
    if (updated.length === 0) throw notFound('Không tìm thấy thông báo.');
    return {
      soft_deleted: true,
      deleted: false,
      message: 'Thông báo đã có người đọc nên chỉ được gỡ đăng (ẩn khỏi danh sách nhân viên).',
    };
  }
  const rows = await query('DELETE FROM announcements WHERE id = $1 RETURNING id', [id]);
  if (rows.length === 0) throw notFound('Không tìm thấy thông báo.');
  return { deleted: true };
}

/* ------------------------------------------------------------------ *
 *  Nhân viên: đọc
 * ------------------------------------------------------------------ */

export interface StaffAnnouncementList {
  rows: AnnouncementWithRead[];
  unread_count: number;
}

/**
 * Danh sách thông báo đã đăng + trạng thái đã đọc của người đang đăng nhập.
 * Nhân viên chỉ thấy thông báo ĐÃ ĐĂNG (is_published).
 */
export async function listAnnouncementsForUser(userId: number): Promise<StaffAnnouncementList> {
  const rows = await query<Announcement & { is_read: boolean; read_at: string | null }>(
    `SELECT ${A_COLUMNS},
            (r.user_id IS NOT NULL) AS is_read,
            r.read_at
       FROM announcements a
       LEFT JOIN announcement_reads r
              ON r.announcement_id = a.id AND r.user_id = $1
      WHERE a.is_published
      ORDER BY a.published_at DESC, a.id DESC
      LIMIT 100`,
    [userId],
  );

  const list: AnnouncementWithRead[] = rows.map((r) => ({
    ...shape(r),
    is_read: Boolean(r.is_read),
    read_at: r.read_at ?? null,
  }));

  return { rows: list, unread_count: list.filter((a) => !a.is_read).length };
}

/** Đánh dấu đã đọc (idempotent). Trả về số thông báo chưa đọc còn lại. */
export async function markAnnouncementRead(announcementId: number, userId: number): Promise<{ unread_count: number }> {
  const found = await queryOne<{ id: number }>(
    'SELECT id FROM announcements WHERE id = $1 AND is_published',
    [announcementId],
  );
  if (!found) throw notFound('Không tìm thấy thông báo.');

  await query(
    `INSERT INTO announcement_reads (announcement_id, user_id)
     VALUES ($1,$2)
     ON CONFLICT (announcement_id, user_id) DO NOTHING`,
    [announcementId, userId],
  );

  const left = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM announcements a
      WHERE a.is_published
        AND NOT EXISTS (
          SELECT 1 FROM announcement_reads r
           WHERE r.announcement_id = a.id AND r.user_id = $1
        )`,
    [userId],
  );
  return { unread_count: left?.count ?? 0 };
}

/** Đánh dấu đã đọc tất cả. */
export async function markAllAnnouncementsRead(userId: number): Promise<{ unread_count: number }> {
  await query(
    `INSERT INTO announcement_reads (announcement_id, user_id)
     SELECT a.id, $1 FROM announcements a
      WHERE a.is_published
     ON CONFLICT (announcement_id, user_id) DO NOTHING`,
    [userId],
  );
  return { unread_count: 0 };
}

/** Đoạn trích dạng text thuần (dùng cho tiêu đề tooltip / danh sách thu gọn). */
export function excerpt(ann: Announcement, maxLen = 140): string {
  return htmlToText(ann.content, maxLen);
}