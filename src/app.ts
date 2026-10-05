import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { checkDatabase } from './db.js';
import { asyncRoute, errorHandler, notFoundHandler, ok } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/customer.js';
import { staffRouter } from './routes/staff.js';
import { adminRouter } from './routes/admin.js';
import { streamRouter, streamStats } from './routes/stream.js';
import { uploadRouter } from './routes/upload.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Header bảo mật cơ bản (không dùng helmet để giữ nhẹ)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // API
  app.get('/api/health', (_req, res) => {
    ok(res, { status: 'ok', env: config.nodeEnv, time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api', publicRouter);
  app.use('/api/staff', staffRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/stream', streamRouter);
  app.use('/api/upload', uploadRouter);

  app.get('/api/debug/sse', (_req, res) => ok(res, streamStats()));

  // Ảnh món ăn
  fs.mkdirSync(config.uploadDir, { recursive: true });
  app.use(
    '/uploads',
    express.static(config.uploadDir, {
      maxAge: '7d',
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    }),
  );

  // Giao diện web đã build
  if (fs.existsSync(config.webDistDir)) {
    app.use(express.static(config.webDistDir, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
      res.sendFile(path.join(config.webDistDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .type('html')
        .send(
          '<h2>API đang chạy</h2><p>Chưa build giao diện. Chạy <code>npm run build</code> hoặc <code>npm run dev</code> để phát triển.</p>',
        );
    });
  }

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}

/** Kiểm tra kết nối DB khi khởi động */
export async function assertDatabase() {
  const okDb = await checkDatabase();
  if (!okDb) {
    throw new Error(
      `Không kết nối được PostgreSQL tại ${config.db.host}:${config.db.port}/${config.db.database}. ` +
        'Kiểm tra lại thông tin trong file .env',
    );
  }
}
