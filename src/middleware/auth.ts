import type { NextFunction, Request, Response } from 'express';
import { verifyStaffToken } from '../auth.js';
import { queryOne } from '../db.js';
import { forbidden, unauthorized } from '../utils.js';
import type { JwtPayload, SessionUser, UserRole } from '../types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: SessionUser;
      staffToken?: string;
      /** Token phiên khách tại bàn (đọc từ header x-table-token hoặc query ?token=) */
      tableToken?: string;
    }
  }
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  const q = req.query.token;
  if (typeof q === 'string' && q) return q;
  return null;
}

/** Bắt buộc đăng nhập bằng tài khoản nhân viên/admin. */
export function requireStaff(req: Request, _res: Response, next: NextFunction) {
  const token = extractBearer(req);
  if (!token) return next(unauthorized());

  let payload: JwtPayload;
  try {
    payload = verifyStaffToken(token);
  } catch {
    return next(unauthorized('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'));
  }

  void (async () => {
    try {
      const user = await queryOne<SessionUser>(
        `SELECT u.id, u.username, u.full_name, u.role, u.phone, u.is_active,
                u.branch_id, b.name AS branch_name
           FROM users u
           LEFT JOIN branches b ON b.id = u.branch_id
          WHERE u.id = $1`,
        [payload.sub],
      );
      if (!user) return next(unauthorized('Tài khoản không tồn tại.'));
      if (!user.is_active) return next(forbidden('Tài khoản đã bị vô hiệu hoá.'));
      req.staff = user;
      req.staffToken = token;
      next();
    } catch (err) {
      next(err);
    }
  })();
}

/** Chỉ Admin mới được phép (quản lý tài khoản, món ăn, bàn, lịch sử order). */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.staff) return next(unauthorized());
  if (req.staff.role !== 'admin') return next(forbidden('Chỉ Admin mới được truy cập chức năng này.'));
  next();
}

/** Gắn tableToken nếu có (không bắt buộc). */
export function attachTableToken(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers['x-table-token'];
  const q = req.query.token;
  const token =
    (typeof header === 'string' && header) || (typeof q === 'string' && q) || undefined;
  if (token) req.tableToken = token;
  next();
}

/** Bắt buộc có token phiên khách hợp lệ (cho các API của màn order). */
export async function requireTableSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.tableToken;
    if (!token) return next(unauthorized('Thiếu token phiên bàn. Vui lòng quét lại mã QR.'));

    const session = await queryOne<{ id: number; token: string }>(
      'SELECT id, token FROM table_sessions WHERE token = $1',
      [token],
    );
    if (!session) return next(unauthorized('Phiên bàn không hợp lệ. Vui lòng quét lại mã QR.'));

    (req as Request & { tableSessionId?: number }).tableSessionId = session.id;
    next();
  } catch (err) {
    next(err);
  }
}

export function hasRole(role: UserRole) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.staff) return next(unauthorized());
    if (req.staff.role !== role) return next(forbidden());
    next();
  };
}
