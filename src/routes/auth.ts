import { Router } from 'express';
import { z } from 'zod';
import { signStaffToken, verifyPassword } from '../auth.js';
import { queryOne } from '../db.js';
import { asyncRoute, ok } from '../middleware/errors.js';
import { requireStaff } from '../middleware/auth.js';
import { unauthorized } from '../utils.js';
import type { SessionUser } from '../types.js';

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Vui lòng nhập tài khoản.'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu.'),
});

/** Thông tin tài khoản gửi về cho UI (kèm cơ sở đang làm việc). */
function publicUser(u: SessionUser) {
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    role: u.role,
    phone: u.phone,
    // null = xem tất cả cơ sở (Admin). NV chưa gán cơ sở thì không thấy đơn nào.
    branch_id: u.branch_id ?? null,
    branch_name: u.branch_name ?? null,
  };
}

/** Đăng nhập cho nhân viên & admin (tài khoản do Admin cấp, không có đăng ký). */
authRouter.post(
  '/login',
  asyncRoute(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);

    const user = await queryOne<SessionUser & { password_hash: string }>(
      `SELECT u.id, u.username, u.full_name, u.role, u.phone, u.is_active, u.password_hash,
              u.branch_id, b.name AS branch_name
         FROM users u
         LEFT JOIN branches b ON b.id = u.branch_id
        WHERE u.username = $1`,
      [username],
    );

    // thông báo chung chung để không lộ tài khoản nào tồn tại
    const invalid = unauthorized('Tài khoản hoặc mật khẩu không đúng.');
    if (!user) throw invalid;
    if (!user.is_active) throw unauthorized('Tài khoản này đã bị vô hiệu hoá. Vui lòng liên hệ Admin.');

    const okPass = await verifyPassword(password, user.password_hash);
    if (!okPass) throw invalid;

    await queryOne('UPDATE users SET last_login_at = NOW() WHERE id = $1 RETURNING id', [user.id]);

    const token = signStaffToken(user);
    ok(res, { token, user: publicUser(user) });
  }),
);

/** Thông tin tài khoản đang đăng nhập */
authRouter.get(
  '/me',
  requireStaff,
  asyncRoute(async (req, res) => {
    ok(res, publicUser(req.staff!));
  }),
);
