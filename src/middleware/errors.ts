import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { config } from '../config.js';
import { HttpError } from '../utils.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, `Không tìm thấy endpoint ${req.method} ${req.path}`, 'NOT_FOUND'));
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'Dữ liệu gửi lên không hợp lệ.',
      details: err.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message })),
    });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({
      ok: false,
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Lỗi ràng buộc DB
  const pgErr = err as { code?: string; constraint?: string; message?: string; detail?: string };
  if (pgErr?.code === '23505') {
    return res.status(409).json({
      ok: false,
      code: 'DUPLICATE',
      message: 'Dữ liệu đã tồn tại (trùng lặp).',
      details: pgErr.constraint,
    });
  }
  if (pgErr?.code === '23503') {
    return res.status(400).json({
      ok: false,
      code: 'FOREIGN_KEY',
      message: 'Không tìm thấy dữ liệu tham chiếu.',
      details: pgErr.constraint,
    });
  }

  console.error('[error]', err);
  return res.status(500).json({
    ok: false,
    code: 'INTERNAL_ERROR',
    message: 'Đã có lỗi xảy ra trên máy chủ.',
    ...(config.isProd ? {} : { debug: (err as Error)?.message, stack: (err as Error)?.stack?.split('\n').slice(0, 6) }),
  });
}

/** Bọc handler bất đồng bộ để lỗi được chuyển sang errorHandler */
export function asyncRoute<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(
  fn: T,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next);
  };
}

export const ok = <T>(res: Response, data: T, status = 200) => res.status(status).json({ ok: true, data });
