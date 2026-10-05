import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { requireAdmin, requireStaff } from '../middleware/auth.js';
import { asyncRoute, ok } from '../middleware/errors.js';
import { badRequest } from '../utils.js';

export const uploadRouter = Router();

fs.mkdirSync(config.uploadDir, { recursive: true });

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10) || '.jpg';
    cb(null, `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) return cb(new Error('Chỉ chấp nhận ảnh JPG/PNG/WEBP/GIF (tối đa 5MB).'));
    cb(null, true);
  },
});

/** Upload ảnh món ăn (nhân viên cũng được phép để cập nhật nhanh) */
uploadRouter.post(
  '/image',
  requireStaff,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return next(badRequest(err.message));
      next();
    });
  },
  asyncRoute(async (req, res) => {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) throw badRequest('Không tìm thấy file ảnh.');
    ok(res, { url: `/uploads/${file.filename}`, size: file.size }, 201);
  }),
);

/** Xoá ảnh đã upload (chỉ Admin) */
uploadRouter.delete(
  '/image',
  requireStaff,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const url = String(req.query.url ?? '');
    const name = path.basename(url);
    if (!name.startsWith('/') && !name.includes('uploads/')) {
      // chỉ cho phép xoá file trong thư mục uploads
      if (url.includes('..')) throw badRequest('Đường dẫn không hợp lệ.');
    }
    const target = path.join(config.uploadDir, name);
    if (!target.startsWith(config.uploadDir)) throw badRequest('Đường dẫn không hợp lệ.');
    if (fs.existsSync(target)) fs.unlinkSync(target);
    ok(res, { deleted: true });
  }),
);
